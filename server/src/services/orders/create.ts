import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { CreateOrderInput } from "../../types/order.type";
import { NEPAL_UTC_OFFSET_MS, formatNepalDate as formatDate } from "../../utils/nepalTime";
import { getDeliveryQuote, getReturnRouteQuote } from "../delivery-rate.service";
import { invalidateVendorFinanceCache } from "../finance.service";
import { getReturnDeliveryQuote, getVendorQuote, type RateType, type ServiceType } from "../pricing.service";
import { resolveOwnVendorId, isStaffActor } from "../vendor-scope.service";
import { resolveVendorClaimTx } from "../voucher.service";
import { assertVendorCanCreateOrder } from "../billing.service";
import { invalidateOrderCaches } from "./cache";
import { vendorRateOverrides, branchVendorFlatCharge, getMasterHubId } from "./pricing";
import { getAdminBranchScope } from "./scope";
import { buildSearchText, generateUniqueTrackingId } from "./orderHelpers";
import type { OrderActor } from "./types";

export async function findOrCreateParty(
  tx: Prisma.TransactionClient,
  partyData: CreateOrderInput["sender"],
  // Parties are keyed by phone and reused across orders. By default a match is
  // returned as-is. `refreshExisting` re-syncs the reused record's name/address
  // to the incoming details - used for the sender, which is the vendor's own
  // identity: if the vendor's shop details change, their sender should reflect
  // the current values instead of whatever was first captured. Only provided,
  // changed fields are written, so an existing email / alternate phone is never
  // wiped by a sender profile that doesn't carry them.
  options?: { refreshExisting?: boolean },
) {
  const normalizedPhone = partyData.phone.trim().replace(/\s/g, "");

  const existing = await tx.parties.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { created_at: "desc" },
  });

  if (existing) {
    if (options?.refreshExisting) {
      const nextName = partyData.name.trim();
      const nextAddress = partyData.address?.trim();
      const update: Prisma.partiesUpdateInput = {};
      if (nextName && nextName !== existing.name) update.name = nextName;
      if (nextAddress && nextAddress !== (existing.address ?? "")) update.address = nextAddress;
      if (Object.keys(update).length > 0) {
        return tx.parties.update({ where: { id: existing.id }, data: update });
      }
    }
    return existing;
  }

  return tx.parties.create({
    data: {
      name: partyData.name.trim(),
      phone: normalizedPhone,
      alternate_phone: partyData.alternatePhone?.trim() || null,
      email: partyData.email?.trim() || null,
      address: partyData.address?.trim() || null,
    },
  });
}

export async function createOrderCore(
  actor: OrderActor,
  data: CreateOrderInput,
  options?: CreateOrderOptions,
) {
  return _createOrderImpl(actor, data, options);
}

// Same-day duplicate guard for interactive (single) order creation only - bulk
// imports go through createOrderCore and are intentionally exempt. Flags an
// order whose vendor already created one today for the same receiver phone
// number. Soft guard: throws a DUPLICATE_ORDER 409 the client turns into a
// "create anyway?" prompt, and is bypassed when the user confirms
// (data.confirmDuplicate) or when the order isn't attributed to a vendor.
async function assertNotDuplicateOrder(actor: OrderActor, data: CreateOrderInput) {
  if (data.confirmDuplicate) return;

  const ownVendorId = await resolveOwnVendorId(actor);
  const vendorId = ownVendorId ?? data.vendorId ?? null;
  if (!vendorId) return;

  const receiverPhone = data.receiver.phone.trim().replace(/\s/g, "");
  if (!receiverPhone) return;

  // Start of today in Nepal local time (parcels.created_at is UTC).
  const nepalToday = formatDate(new Date());
  const todayStart = new Date(Date.parse(`${nepalToday}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS);

  const existing = await prisma.parcels.findFirst({
    where: {
      vendor_id: vendorId,
      deleted_at: null,
      created_at: { gte: todayStart },
      parties_parcels_receiver_idToparties: {
        phone: receiverPhone,
      },
    },
    orderBy: { created_at: "desc" },
    select: { order_number: true, tracking_id: true },
  });

  if (existing) {
    throw new AppError(
      409,
      `A similar order for ${receiverPhone} was already created today (Order #${existing.order_number}, ${existing.tracking_id}).`,
      "DUPLICATE_ORDER",
    );
  }
}

export interface CreateOrderOptions {
  // Set by bulkCreateOrders once it has cleared the importing vendor up front,
  // so a 500-row import doesn't re-check the same account 500 times.
  skipBillingCheck?: boolean;
}

export async function createOrder(actor: OrderActor, data: CreateOrderInput) {
  await assertNotDuplicateOrder(actor, data);
  const parcel = await _createOrderImpl(actor, data);
  // Fire-and-forget: Redis latency should never add to the caller's response time.
  invalidateOrderCaches().catch((err) => console.error("[Redis] cache invalidation failed:", err));
  if (parcel.vendor_id) {
    invalidateVendorFinanceCache(parcel.vendor_id).catch((err) => console.error("[Redis] cache invalidation failed:", err));
  }
  return parcel;
}

async function _createOrderImpl(
  actor: OrderActor,
  data: CreateOrderInput,
  options: CreateOrderOptions = {},
) {
  if (data.weightKg !== undefined && (!Number.isFinite(data.weightKg) || data.weightKg <= 0)) {
    throw new AppError(400, "weightKg must be a positive number");
  }
  if (data.codAmount !== undefined && (!Number.isFinite(data.codAmount) || data.codAmount < 0)) {
    throw new AppError(400, "codAmount cannot be negative");
  }
  if (data.itemValue !== undefined && (!Number.isFinite(data.itemValue) || data.itemValue < 0)) {
    throw new AppError(400, "itemValue cannot be negative");
  }
  if (data.deliveryCharge !== undefined && (!Number.isFinite(data.deliveryCharge) || data.deliveryCharge < 0)) {
    throw new AppError(400, "deliveryCharge cannot be negative");
  }
  if (data.pieces !== undefined && (!Number.isInteger(data.pieces) || data.pieces <= 0)) {
    throw new AppError(400, "pieces must be a positive integer");
  }
  if (data.voucherClaimId && data.voucherCode) {
    throw new AppError(400, "Provide either voucherClaimId or voucherCode, not both");
  }

  // Resolves vendor AND vendor_staff actors to their own vendor - previously
  // only the "vendor" role was auto-resolved here, so orders created by a
  // vendor_staff account got vendor_id: null (orphaned from their vendor's
  // order list, COD collections, and settlements).
  const ownVendorId = await resolveOwnVendorId(actor);

  // A sales actor picking a vendorId (e.g. bulk-importing on behalf of a
  // client) can only ever pick a vendor they own - matches the sales_user_id
  // scoping already enforced on the vendor list / dashboard / tickets.
  const isSalesActor = actor.roles.includes("sales") && !isStaffActor(actor);

  // Hub inheritance: a plain/branch admin's orders always originate from that
  // admin's own hub. A super_admin (or vendor) order otherwise picks up from
  // the attached vendor's own hub - where the parcel physically is - not a UI
  // default. Both take precedence over data.originLocationId below.
  let forcedAdminHub: string | null = null;
  if (isStaffActor(actor) && !actor.roles.includes("super_admin")) {
    const actorAdmin = await prisma.admins.findFirst({
      where: { user_id: actor.id },
      select: { location_id: true },
    });
    forcedAdminHub = actorAdmin?.location_id ?? null;
  }

  // A branch-scoped admin may only key an order in for one of its own branch's
  // vendors; a picked vendor outside that coverage resolves to null and 404s
  // below, the same as an unknown id.
  const adminBranchIds = await getAdminBranchScope(actor);

  // Run the remaining two independent reads in parallel.
  const [vendor, originLoc, destinationLoc] = await Promise.all([
    ownVendorId
      ? prisma.vendors.findFirst({
          where: { id: ownVendorId, deleted_at: null, status: "active" },
        })
      : data.vendorId
      ? prisma.vendors.findFirst({
          where: {
            id: data.vendorId,
            deleted_at: null,
            status: "active",
            ...(isSalesActor ? { sales_user_id: actor.id } : {}),
            ...(adminBranchIds ? { location_id: { in: adminBranchIds } } : {}),
          },
        })
      : Promise.resolve(null),
    data.originLocationId
      ? prisma.locations.findUnique({ where: { id: data.originLocationId } })
      : Promise.resolve(null),
    data.destinationLocationId
      ? prisma.locations.findUnique({ where: { id: data.destinationLocationId } })
      : Promise.resolve(null),
  ]);

  if (ownVendorId && !vendor) throw new AppError(403, "Vendor profile not found or inactive");
  if (!ownVendorId && data.vendorId && !vendor) throw new AppError(404, "Vendor not found or inactive");
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");

  // Credit control. Sits here rather than in a controller because order
  // creation has three entry points - the dashboard, the bulk import, and the
  // partner API at POST /api/v1/orders - and all three funnel through this
  // function. A controller-level guard would leave the partner API open.
  //
  // The block follows the vendor, not the actor: an admin keying an order in on
  // behalf of a blocked vendor is blocked too. Only a super_admin can override,
  // and only by asking for it explicitly.
  if (vendor && !options.skipBillingCheck) {
    const overriding = data.overrideBillingBlock === true && actor.roles.includes("super_admin");
    if (!overriding) {
      await assertVendorCanCreateOrder(vendor.id);
    }
  }

  const resolvedOriginLocationId =
    forcedAdminHub || vendor?.location_id || data.originLocationId || data.sender.locationId || null;
  const resolvedDestinationLocationId = data.destinationLocationId || data.receiver.locationId || null;
  const masterHubId = await getMasterHubId();
  const weightKg = data.weightKg || 1;

  // A return parcel is goods the customer hands back for the vendor (created on
  // an exchange delivery or a return pickup). It never carries COD, so force it
  // to 0 regardless of what the caller passed. It still incurs a delivery charge
  // (a percent of the normal rate, see below) which is billed via settlement.
  const isReturnOrder = (data.orderType || "delivery") === "return";
  const codAmount = isReturnOrder ? 0 : data.codAmount || 0;
  const itemValue = data.itemValue || 0;

  // Payable is computed server-side so the client can't spoof the charge.
  //  1. Branch-origin orders price off the (branch → destination) route rate
  //     table - the branch leg is its own charge, not the vendor's Imadol model.
  //  2. Vendor orders from Imadol price by the vendor's rate model
  //     (per-destination / zone / flat).
  //  3. Non-vendor orders fall back to the legacy origin→destination route rate.
  //  4. Otherwise a manually supplied charge, else 0.
  // Return orders are charged the return percent of the normal rate for the path taken.
  const originIsBranch = Boolean(
    resolvedOriginLocationId && masterHubId && resolvedOriginLocationId !== masterHubId,
  );
  let deliveryCharge = data.deliveryCharge || 0;
  if (originIsBranch && resolvedDestinationLocationId) {
    const serviceType = (data.serviceType as ServiceType) || "home_delivery";
    try {
      // A branch vendor on the flat model pays its own inside/outside-branch
      // rate; without one set, the branch route rate applies as before.
      const flatCharge = await branchVendorFlatCharge(
        vendor, resolvedOriginLocationId!, resolvedDestinationLocationId, weightKg, serviceType, isReturnOrder,
      );
      const quote = flatCharge !== null
        ? { totalPayable: flatCharge }
        : isReturnOrder
        ? await getReturnRouteQuote(resolvedOriginLocationId!, resolvedDestinationLocationId, weightKg, serviceType)
        : await getDeliveryQuote(resolvedOriginLocationId!, resolvedDestinationLocationId, weightKg, serviceType);
      deliveryCharge = quote.totalPayable;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        throw new AppError(
          400,
          "No delivery rate is configured for this branch's route. Add it under Delivery Charges before creating the order.",
        );
      }
      throw error;
    }
  } else if (vendor && resolvedDestinationLocationId) {
    const overrides = vendorRateOverrides(vendor);
    const serviceType = (data.serviceType as ServiceType) || "home_delivery";
    const quote = isReturnOrder
      ? await getReturnDeliveryQuote(vendor.rate_type as RateType, resolvedDestinationLocationId, weightKg, overrides, serviceType)
      : await getVendorQuote(vendor.rate_type as RateType, resolvedDestinationLocationId, weightKg, overrides, serviceType);
    deliveryCharge = quote.totalPayable;
  } else if (resolvedOriginLocationId && resolvedDestinationLocationId) {
    const quote = await getDeliveryQuote(
      resolvedOriginLocationId,
      resolvedDestinationLocationId,
      weightKg,
      (data.serviceType as ServiceType) || "home_delivery",
    );
    deliveryCharge = quote.totalPayable;
  }

  const senderPhone = data.sender.phone.trim().replace(/\s/g, "");
  const receiverPhone = data.receiver.phone.trim().replace(/\s/g, "");
  if (senderPhone === receiverPhone) {
    throw new AppError(400, "Sender and receiver cannot have the same phone number");
  }

  const parcel = await prisma.$transaction(async (tx) => {
    const trackingId = await generateUniqueTrackingId(tx);

    const [sender, receiver] = await Promise.all([
      // Sender is the vendor's own identity - keep it synced with their current
      // profile so a shop/address change propagates to new orders.
      findOrCreateParty(tx, data.sender, { refreshExisting: true }),
      findOrCreateParty(tx, data.receiver),
    ]);

    let parcel = await tx.parcels.create({
      data: {
        tracking_id: trackingId,
        search_text: buildSearchText(trackingId, sender, receiver),
        vendor_id: vendor?.id || null,
        sender_id: sender.id,
        receiver_id: receiver.id,
        origin_location_id: resolvedOriginLocationId,
        current_location_id: resolvedOriginLocationId,
        destination_location_id: resolvedDestinationLocationId,
        order_type: data.orderType || "delivery",
        service_type: data.serviceType || "home_delivery",
        status: "pickup_ordered",
        pieces: data.pieces || 1,
        weight_kg: weightKg,
        cod_amount: codAmount,
        item_value: itemValue,
        delivery_charge: deliveryCharge,
        // "Parcel" matches the dashboard's own create-order form, which
        // pre-fills the same value - so an order created with no package
        // type set (most API callers, since it's rarely relevant to them)
        // looks the same everywhere staff view it, instead of showing blank.
        package_type: data.packageType || "Parcel",
        delivery_instruction: data.deliveryInstruction || null,
        allow_partial_delivery: data.allowPartialDelivery ?? false,
        created_by: actor.id,
      },
    });

    // Daraz-style voucher: the pricing trigger forbids a claim on INSERT, so
    // attach it here with an update in the same transaction — the trigger
    // reserves the claim and writes gross/discount/net atomically, and a
    // failure rolls the whole order back with it.
    if (data.voucherClaimId || data.voucherCode) {
      if ((data.orderType || 'delivery') !== 'delivery') {
        throw new AppError(400, 'Vouchers apply to outbound delivery orders only');
      }
      const claim = await resolveVendorClaimTx(tx, vendor?.id ?? null, actor.id, {
        claimId: data.voucherClaimId, code: data.voucherCode,
      });
      const minimum = Number(claim.voucher.minimum_charge);
      if (deliveryCharge < minimum) {
        throw new AppError(400, `This voucher needs a minimum delivery charge of Rs. ${minimum.toFixed(2)} (this order: Rs. ${deliveryCharge.toFixed(2)})`);
      }
      await tx.parcels.update({ where: { id: parcel.id }, data: { voucher_claim_id: claim.id } });
      const priced = await tx.parcels.findUniqueOrThrow({ where: { id: parcel.id },
        select: { delivery_charge: true, gross_delivery_charge: true, discount_amount: true, voucher_claim_id: true } });
      parcel = { ...parcel, ...priced, voucherCode: claim.voucher.code } as typeof parcel & { voucherCode: string };
    }

    // Secondary writes are logically independent, but tx is bound to a
    // single Postgres connection - Promise.all here doesn't run them in
    // parallel, it pipelines overlapping queries onto that one client, which
    // pg now deprecates ("client.query() called while already executing a
    // query", removed in pg@9). Awaited sequentially instead; same cost.
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: null,
        new_status: "pickup_ordered",
        location_id: parcel.current_location_id,
        changed_by: actor.id,
        remarks: "Order created",
      },
    });
    await tx.pickup_tasks.create({
      data: {
        parcel_id: parcel.id,
        pickup_address: data.pickupAddress || data.sender.address || null,
        scheduled_at: data.scheduledPickupAt ? new Date(data.scheduledPickupAt) : null,
        status: "pickup_ordered",
      },
    });
    await tx.cod_collections.create({
      data: {
        parcel_id: parcel.id,
        vendor_id: vendor?.id || null,
        cod_amount: codAmount,
        payment_status: "pending",
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "CREATE_ORDER",
        new_data: {
          trackingId: parcel.tracking_id,
          senderId: sender.id,
          receiverId: receiver.id,
        },
      },
    });
    if (data.remarks?.trim()) {
      await tx.parcel_remarks.create({
        data: {
          parcel_id: parcel.id,
          user_id: actor.id,
          remark: data.remarks.trim(),
        },
      });
    }

    return parcel;
  });

  // New orders no longer notify admins - a ping per created order floods the
  // notification feed. Admins are still notified on the actionable events
  // downstream (arrival at branch, delivery/COD settlement).

  return parcel;
}

// A parcel that has reached a terminal state is settled paperwork — its
// details (COD, receiver, route) feed finance and RTO records and must not
// change underneath them.
