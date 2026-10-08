import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { resolveOwnVendorId } from "../vendor-scope.service";
import type { OrderActor } from "./types";

const locationName = (location?: { name: string; city: string | null; district: string | null } | null) => location?.name ?? "";

// The vendor IS the default sender for any order they create - this resolves
// their own business identity server-side so the client never has to ask a
// vendor (or their staff) to type in "who is sending this", and can't diverge
// from the vendor_id the order actually gets attributed to.
export async function getSenderProfile(actor: OrderActor) {
  const ownVendorId = await resolveOwnVendorId(actor);
  if (!ownVendorId) {
    throw new AppError(403, "Only vendors or their staff have a default sender profile");
  }

  const vendor = await prisma.vendors.findFirst({
    where: { id: ownVendorId, deleted_at: null, status: "active" },
    select: { id: true, business_name: true, client_name: true, phone: true, address: true, pickup_landmark: true, location_id: true },
  });
  if (!vendor) {
    throw new AppError(403, "Vendor profile not found or inactive");
  }

  // The sender address is driven by the vendor's selected pickup Location, so
  // changing the shop's location updates where new orders ship from. The pickup
  // landmark (a finer detail like "near X chowk") is appended after it, and the
  // free-text address is only a last-resort fallback when no Location is set.
  const location = vendor.location_id
    ? await prisma.locations.findUnique({
        where: { id: vendor.location_id },
        select: { name: true, city: true, district: true },
      })
    : null;
  const locationLabel = locationName(location);
  const address =
    [locationLabel, vendor.pickup_landmark].filter(Boolean).join(", ") || vendor.address || "";

  return {
    id: vendor.id,
    name: vendor.business_name || vendor.client_name,
    phone: vendor.phone,
    address,
    locationId: vendor.location_id,
  };
}

