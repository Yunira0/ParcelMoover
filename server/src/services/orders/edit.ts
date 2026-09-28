import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { OrderPartyInput, UpdateOrderDetailsInput } from "../../types/order.type";
import { hasAdminPermission } from "../../middlewares/adminPermission.middleware";
import { getDeliveryQuote, getReturnRouteQuote } from "../delivery-rate.service";
import { invalidateVendorFinanceCache } from "../finance.service";
import { getReturnDeliveryQuote, getVendorQuote, type RateType, type ServiceType } from "../pricing.service";
import { resolveOwnVendorId } from "../vendor-scope.service";
import { invalidateOrderCaches } from "./cache";
import { findOrCreateParty } from "./create";
import { buildSearchText } from "./orderHelpers";
import { vendorRateOverrides, branchVendorFlatCharge, getMasterHubId } from "./pricing";
import { getAdminBranchScope, getActorScope, branchTouchesFilter } from "./scope";
import type { OrderActor } from "./types";

const EDIT_BLOCKED_STATUSES: parcel_status[] = [
  "delivered",
  "partially_delivered",
  "cancelled",
  "returned_to_vendor",
  "loss_and_damage",
];

// Vendor-side actors may only edit while the parcel is still theirs to hand
// over; once it's in the network, changes go through ops staff.
const VENDOR_EDITABLE_STATUSES: parcel_status[] = [
  "pickup_ordered",
  "rider_assigned",
  "failed_pickup",
];

// A parcel in EDIT_BLOCKED_STATUSES is otherwise settled paperwork, but a
// wrong COD amount (customer dispute, data-entry mistake) still needs
// correcting after delivery/RTV/RTO. Narrow escape hatch: super_admin or an
// admin holding EDIT_COD_LOCKED may still change codAmount alone, as long as
// the money hasn't actually moved yet - once cod_collections.payment_status
// is "paid" the parcel's COD must never drift from what was already settled.
// Callers decide "codAmount alone" from the actual before/after diff (see
// changedKeys below), not from which fields the request happened to include -
// the full-page edit form always resubmits every field, changed or not.
async function canOverrideCodOnBlockedParcel(actor: OrderActor, parcelId: string): Promise<boolean> {
  const isPrivileged =
    actor.roles.includes("super_admin") || (await hasAdminPermission(actor, "EDIT_COD_LOCKED"));
  if (!isPrivileged) return false;

  const collection = await prisma.cod_collections.findFirst({
    where: { parcel_id: parcelId },
    select: {
      payment_status: true,
      settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
    },
  });
  if (collection && collection.payment_status !== "pending") {
    throw new AppError(409, "COD has already been settled to the vendor and can no longer be edited here.");
  }
  // Also blocked while still pending, if it's already bundled into a
  // settlement: that settlement's settlement_items row already froze this
  // collection's amount at creation time, and editing the COD here would
  // desync from it with no record of why. Staff must remove it via the
  // settlement edit flow first.
  if (collection && collection.settlement_items.length > 0) {
    const stmt = collection.settlement_items[0]!.settlements;
    throw new AppError(
      409,
      `This order is part of ${stmt.payee_type} settlement ${stmt.statement_id} — remove it from the settlement before editing COD.`,
    );
  }
  return true;
}

async function upsertPartyByPhone(
  tx: Prisma.TransactionClient,
  partyData: OrderPartyInput,
) {
  const normalizedPhone = partyData.phone.trim().replace(/\s/g, "");
  const existing = await tx.parties.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { created_at: "desc" },
  });
  const fields = {
    name: partyData.name.trim(),
    alternate_phone: partyData.alternatePhone?.trim() || null,
    address: partyData.address?.trim() || null,
  };
  if (existing) {
    return tx.parties.update({ where: { id: existing.id }, data: fields });
  }
  return tx.parties.create({ data: { ...fields, phone: normalizedPhone } });
}

export async function updateOrderDetails(
  actor: OrderActor,
  parcelId: string,
  data: UpdateOrderDetailsInput,
) {
  const ownVendorId = await resolveOwnVendorId(actor);
  // Defense in depth: sales aren't currently routed here, but if they ever are,
  // scope them to parcels of the vendors they own.
  const isStaffActor = actor.roles.some((r) => ["admin", "super_admin"].includes(r));
  const salesVendorIds = !ownVendorId && !isStaffActor && actor.roles.includes("sales")
    ? (await getActorScope(actor)).vendorIds
    : undefined;
  const adminBranchIds = await getAdminBranchScope(actor);

  // Reassigning the order to a different vendor is an ops-staff action only —
  // a vendor/vendor_staff actor is already scoped to their own vendor_id via
  // the `parcel` lookup below, so letting them also pick a new vendorId here
  // would let them hand their parcel off to (or take one from) another vendor.
  if (data.vendorId !== undefined && ownVendorId) {
    throw new AppError(403, "Vendors cannot reassign the vendor on an order");
  }

  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      ...(ownVendorId ? { vendor_id: ownVendorId } : {}),
      ...(salesVendorIds ? { vendor_id: { in: salesVendorIds } } : {}),
      ...(adminBranchIds ? branchTouchesFilter(adminBranchIds) : {}),
    },
    include: {
      parties_parcels_sender_idToparties: true,
      parties_parcels_receiver_idToparties: true,
      vendors: true,
    },
  });
  if (!parcel) throw new AppError(404, "Order not found");

  if (ownVendorId && !VENDOR_EDITABLE_STATUSES.includes(parcel.status)) {
    throw new AppError(409, "This parcel is already in the delivery network — contact support to change it");
  }

  const [originLoc, destinationLoc, newVendor] = await Promise.all([
    data.originLocationId
      ? prisma.locations.findUnique({ where: { id: data.originLocationId } })
      : Promise.resolve(null),
    data.destinationLocationId
      ? prisma.locations.findUnique({ where: { id: data.destinationLocationId } })
      : Promise.resolve(null),
    data.vendorId
      ? prisma.vendors.findFirst({ where: { id: data.vendorId, deleted_at: null, status: "active" } })
      : Promise.resolve(null),
  ]);
  if (data.originLocationId && (!originLoc || !originLoc.is_active))
    throw new AppError(400, "Origin location not found or inactive");
  if (data.destinationLocationId && (!destinationLoc || !destinationLoc.is_active))
    throw new AppError(400, "Destination location not found or inactive");
  if (data.vendorId && !newVendor) throw new AppError(404, "Vendor not found or inactive");
  const vendorChanged = data.vendorId !== undefined && data.vendorId !== parcel.vendor_id;

  const currentReceiver = parcel.parties_parcels_receiver_idToparties;
  const currentWeight = parcel.weight_kg === null ? undefined : Number(parcel.weight_kg);

  // Return parcels never carry COD. If this order already is - or is now being
  // turned into - a return, force COD to 0 so it stays out of COD settlement.
  const effectiveOrderType = data.orderType ?? parcel.order_type;
  if (effectiveOrderType === "return") {
    data.codAmount = 0;
  }

  // Human-readable trail of what changed — each entry carries the previous and
  // new value ("COD amount: 1000 → 1200") and is written into the parcel's
  // history so the order detail page shows who edited what.
  const changedKeys = new Set<string>();
  const changedFields: string[] = [];
  const note = (key: string, oldValue: unknown, newValue: unknown) => {
    changedKeys.add(key);
    const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
    changedFields.push(`${key}: ${show(oldValue)} → ${show(newValue)}`);
  };
  if (vendorChanged) {
    note("vendor", parcel.vendors?.business_name || parcel.vendors?.client_name, newVendor?.business_name || newVendor?.client_name);
  }
  if (data.receiver) {
    const normalizedPhone = data.receiver.phone.trim().replace(/\s/g, "");
    if (data.receiver.name.trim() !== currentReceiver.name)
      note("receiver name", currentReceiver.name, data.receiver.name.trim());
    if (normalizedPhone !== currentReceiver.phone)
      note("receiver phone", currentReceiver.phone, normalizedPhone);
    if ((data.receiver.alternatePhone?.trim() || null) !== currentReceiver.alternate_phone)
      note("receiver alt phone", currentReceiver.alternate_phone, data.receiver.alternatePhone?.trim());
    if ((data.receiver.address?.trim() || null) !== currentReceiver.address)
      note("receiver address", currentReceiver.address, data.receiver.address?.trim());
  }
  if (data.originLocationId !== undefined && data.originLocationId !== parcel.origin_location_id) {
    const oldName = parcel.origin_location_id
      ? (await prisma.locations.findUnique({ where: { id: parcel.origin_location_id } }))?.name
      : null;
    note("origin", oldName ?? parcel.origin_location_id, originLoc?.name ?? data.originLocationId);
  }
  if (data.destinationLocationId !== undefined && data.destinationLocationId !== parcel.destination_location_id) {
    const oldName = parcel.destination_location_id
      ? (await prisma.locations.findUnique({ where: { id: parcel.destination_location_id } }))?.name
      : null;
    note("destination", oldName ?? parcel.destination_location_id, destinationLoc?.name ?? data.destinationLocationId);
  }
  if (data.orderType !== undefined && data.orderType !== parcel.order_type)
    note("order type", parcel.order_type, data.orderType);
  if (data.serviceType !== undefined && data.serviceType !== parcel.service_type)
    note("service type", parcel.service_type, data.serviceType);
  if (data.pieces !== undefined && data.pieces !== parcel.pieces) note("pieces", parcel.pieces, data.pieces);
  if (data.weightKg !== undefined && data.weightKg !== currentWeight)
    note("weight", currentWeight, data.weightKg);
  if (data.codAmount !== undefined && data.codAmount !== Number(parcel.cod_amount))
    note("COD amount", Number(parcel.cod_amount), data.codAmount);
  if (data.itemValue !== undefined && data.itemValue !== Number(parcel.item_value))
    note("Item value", Number(parcel.item_value), data.itemValue);
  if (data.packageType !== undefined && data.packageType !== (parcel.package_type || undefined))
    note("package type", parcel.package_type, data.packageType);
  if (data.deliveryInstruction !== undefined && data.deliveryInstruction !== (parcel.delivery_instruction || undefined))
    note("delivery instruction", parcel.delivery_instruction, data.deliveryInstruction);

  if (changedFields.length === 0) return parcel;

  if (EDIT_BLOCKED_STATUSES.includes(parcel.status)) {
    const isCodOnlyChange = changedKeys.size === 1 && changedKeys.has("COD amount");
    if (!isCodOnlyChange || !(await canOverrideCodOnBlockedParcel(actor, parcel.id))) {
      throw new AppError(409, `Order can no longer be edited in status "${parcel.status}"`);
    }
  }

  // Weight or destination changes re-price the parcel with the same waterfall
  // as order creation (vendor rate model, then route rate, else keep as-is).
  let deliveryCharge = Number(parcel.delivery_charge);
  const destinationLocationId = data.destinationLocationId ?? parcel.destination_location_id;
  const originLocationId = data.originLocationId ?? parcel.origin_location_id;
  const weightKg = data.weightKg ?? currentWeight ?? 1;
  const repriceNeeded =
    changedKeys.has("weight") || changedKeys.has("destination") || changedKeys.has("origin") || vendorChanged;
  // A vendor reassignment reprices against the NEW vendor's rate model, not the old one.
  const effectiveVendor = vendorChanged ? newVendor : parcel.vendors;
  const masterHubId = await getMasterHubId();
  const originIsBranch = Boolean(originLocationId && masterHubId && originLocationId !== masterHubId);
  if (repriceNeeded && destinationLocationId) {
    if (originIsBranch && originLocationId) {
      // Branch-origin: route-table rate, same as creation - including the
      // friendly 400 when the branch route has no rate configured.
      const serviceType = (data.serviceType ?? parcel.service_type) as ServiceType;
      try {
        const flatCharge = await branchVendorFlatCharge(
          effectiveVendor, originLocationId, destinationLocationId, weightKg, serviceType, effectiveOrderType === "return",
        );
        const quote = flatCharge !== null
          ? { totalPayable: flatCharge }
          : effectiveOrderType === "return"
          ? await getReturnRouteQuote(originLocationId, destinationLocationId, weightKg, serviceType)
          : await getDeliveryQuote(originLocationId, destinationLocationId, weightKg, serviceType);
        deliveryCharge = quote.totalPayable;
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) {
          throw new AppError(
            400,
            "No delivery rate is configured for this branch's route. Add it under Delivery Charges before saving.",
          );
        }
        throw error;
      }
    } else if (effectiveVendor) {
      const vendor = effectiveVendor;
      const overrides = vendorRateOverrides(vendor);
      const serviceType = (data.serviceType ?? parcel.service_type) as ServiceType;
      // Return orders re-price at the vendor's return percent of the normal rate.
      const quote = effectiveOrderType === "return"
        ? await getReturnDeliveryQuote(vendor.rate_type as RateType, destinationLocationId, weightKg, overrides, serviceType)
        : await getVendorQuote(vendor.rate_type as RateType, destinationLocationId, weightKg, overrides, serviceType);
      deliveryCharge = quote.totalPayable;
    } else if (originLocationId) {
      const quote = await getDeliveryQuote(
        originLocationId,
        destinationLocationId,
        weightKg,
        (data.serviceType ?? parcel.service_type) as ServiceType,
      );
      deliveryCharge = quote.totalPayable;
    }
  }

  // Correcting COD on an already-delivered parcel (see canOverrideCodOnBlockedParcel
  // above) has to keep cod_collections.collected_amount honest, or the
  // settlement ledger keeps showing the pre-correction figure as cash in hand.
  // How depends on which kind of delivery it was:
  //   - "delivered": the rider collected the full declared COD, so collected
  //     tracks the corrected amount exactly.
  //   - "partially_delivered": collected is an independently counted figure -
  //     the cash the customer actually handed over. Correcting a wrong DECLARED
  //     amount must not move COUNTED cash, so it's left alone and only clamped
  //     if the correction drops the total below what was already collected.
  // Other blocked statuses (cancelled/returned_to_vendor/loss_and_damage) never
  // had a real collection event, so their collected_amount stays untouched.
  // Same "still pending" guard as the cod_amount write below - once the vendor
  // leg is paid, the parcel's COD can no longer drift from what was settled.
  let codSyncCollectedAmount: number | null = null;
  if (
    data.codAmount !== undefined &&
    changedKeys.has("COD amount") &&
    ["delivered", "partially_delivered"].includes(parcel.status)
  ) {
    const existingCod = await prisma.cod_collections.findUnique({
      where: { parcel_id: parcel.id },
      select: { collected_amount: true, payment_status: true },
    });
    if (existingCod && existingCod.payment_status === "pending") {
      codSyncCollectedAmount =
        parcel.status === "delivered"
          ? data.codAmount
          : Math.min(Number(existingCod.collected_amount), data.codAmount);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    let receiverId = parcel.receiver_id;
    let receiver = currentReceiver;
    if (data.receiver) {
      receiver = await upsertPartyByPhone(tx, data.receiver);
      receiverId = receiver.id;
    }

    // Sender is the vendor's own identity (same as order creation) — when the
    // vendor is reassigned, the sender party is re-resolved from the NEW
    // vendor's profile instead of staying pinned to the old one.
    let senderId = parcel.sender_id;
    let sender = parcel.parties_parcels_sender_idToparties;
    if (vendorChanged && newVendor) {
      sender = await findOrCreateParty(
        tx,
        {
          name: newVendor.business_name || newVendor.client_name,
          phone: newVendor.phone,
          ...(newVendor.address ? { address: newVendor.address } : {}),
          ...(newVendor.location_id ? { locationId: newVendor.location_id } : {}),
        },
        { refreshExisting: true },
      );
      senderId = sender.id;
    }

    const updatedParcel = await tx.parcels.update({
      where: { id: parcel.id },
      data: {
        vendor_id: vendorChanged ? newVendor!.id : parcel.vendor_id,
        sender_id: senderId,
        receiver_id: receiverId,
        origin_location_id: originLocationId,
        destination_location_id: destinationLocationId,
        order_type: data.orderType ?? parcel.order_type,
        service_type: data.serviceType ?? parcel.service_type,
        pieces: data.pieces ?? parcel.pieces,
        weight_kg: weightKg,
        cod_amount: data.codAmount ?? parcel.cod_amount,
        // Mirrors the clamp above so the parcel's own record of the partial
        // never exceeds (or disagrees with) the collection it's derived from.
        ...(codSyncCollectedAmount !== null && parcel.status === "partially_delivered"
          ? { partial_cod_collected: codSyncCollectedAmount }
          : {}),
        item_value: data.itemValue ?? parcel.item_value,
        delivery_charge: deliveryCharge,
        package_type: data.packageType !== undefined ? data.packageType || null : parcel.package_type,
        delivery_instruction:
          data.deliveryInstruction !== undefined ? data.deliveryInstruction || null : parcel.delivery_instruction,
        search_text: buildSearchText(parcel.tracking_id, sender, receiver),
      },
    });

    const writes: Prisma.PrismaPromise<unknown>[] = [
      // Same-status history entry: records WHO edited the parcel info and what
      // they touched, without pretending the status moved.
      tx.parcel_status_history.create({
        data: {
          parcel_id: parcel.id,
          old_status: parcel.status,
          new_status: parcel.status,
          location_id: parcel.current_location_id,
          changed_by: actor.id,
          remarks: `Parcel info edited — ${changedFields.join("; ")}`.slice(0, 500),
        },
      }),
      tx.audit_logs.create({
        data: {
          actor_id: actor.id,
          entity_type: "parcel",
          entity_id: parcel.id,
          action: "UPDATE_ORDER",
          old_data: {
            receiverId: parcel.receiver_id,
            destinationLocationId: parcel.destination_location_id,
            codAmount: Number(parcel.cod_amount),
            itemValue: Number(parcel.item_value),
            weightKg: currentWeight ?? null,
            deliveryCharge: Number(parcel.delivery_charge),
          },
          new_data: {
            changedFields,
            receiverId,
            destinationLocationId,
            codAmount: Number(updatedParcel.cod_amount),
            itemValue: Number(updatedParcel.item_value),
            weightKg: Number(updatedParcel.weight_kg),
            deliveryCharge: Number(updatedParcel.delivery_charge),
          },
        },
      }),
    ];
    // cod_collections.vendor_id is denormalized off the parcel for fast
    // per-vendor settlement queries — keep it in sync on reassignment.
    // Scoped to still-pending rows, same as the codAmount sync below: once
    // collected/settled, EDIT_BLOCKED_STATUSES already forbids editing the parcel.
    if (vendorChanged || (data.codAmount !== undefined && changedKeys.has("COD amount"))) {
      writes.push(
        tx.cod_collections.updateMany({
          where: { parcel_id: parcel.id, payment_status: "pending" },
          // Blanket-zeroing collected_amount here used to be safe because
          // EDIT_BLOCKED_STATUSES kept this path off delivered parcels. It no
          // longer does - EDIT_COD_LOCKED lets staff correct the COD on a
          // delivered/RTV/RTO parcel - so the collected figure has to be
          // resolved by the caller (codSyncCollectedAmount) rather than reset.
          data: {
            ...(data.codAmount !== undefined && changedKeys.has("COD amount") ? { cod_amount: data.codAmount } : {}),
            ...(codSyncCollectedAmount !== null ? { collected_amount: codSyncCollectedAmount } : {}),
            ...(vendorChanged ? { vendor_id: newVendor!.id } : {}),
          },
        }),
      );
    }
    await Promise.all(writes);

    return updatedParcel;
  });

  invalidateOrderCaches().catch((err) => console.error("[Redis] cache invalidation failed:", err));
  if (parcel.vendor_id) {
    invalidateVendorFinanceCache(parcel.vendor_id).catch((err) =>
      console.error("[Redis] cache invalidation failed:", err),
    );
  }
  if (vendorChanged && newVendor) {
    invalidateVendorFinanceCache(newVendor.id).catch((err) =>
      console.error("[Redis] cache invalidation failed:", err),
    );
  }

  return updated;
}

// A redirect is only meaningful while the parcel can still be re-routed: once
// it's delivered, returned or written off, the destination is history. The last
// point ops can still act is sent_for_delivery (call the rider back), so
// everything past that - and the whole RTO chain - is closed to redirects.
