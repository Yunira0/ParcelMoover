import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

/**
 * Imadol is the transit (relay) hub: any branch may route a parcel to it
 * regardless of the parcel's real destination, and Imadol forwards it on.
 * Matched the same way as branch.service's master lookup.
 */
export async function isRelayHub(locationId: string): Promise<boolean> {
  const loc = await prisma.locations.findUnique({
    where: { id: locationId },
    select: { code: true, name: true, parent_id: true },
  });
  if (!loc || loc.parent_id) return false;
  return (
    (loc.code || "").trim().toUpperCase() === "IMADOL" ||
    (!loc.code?.trim() && loc.name.trim().toLowerCase() === "imadol")
  );
}

/**
 * arrived_at_branch → oov is the relay hop: the parcel reached a hub that isn't
 * its destination and must be forwarded. A hub that already covers the
 * destination must deliver instead. Unverifiable locations are let through.
 */
export async function assertRelayForward(parcel: {
  tracking_id: string;
  current_location_id: string | null;
  destination_location_id: string | null;
}): Promise<void> {
  const { current_location_id: currentId, destination_location_id: destId } = parcel;
  if (!currentId || !destId) return;
  if (currentId === destId) {
    throw new AppError(422, `Parcel ${parcel.tracking_id} is already at its destination hub - deliver it instead of forwarding.`);
  }
  const [current, dest] = await Promise.all([
    prisma.locations.findUnique({
      where: { id: currentId },
      select: { id: true, parent_id: true, other_locations: { where: { is_active: true }, select: { id: true } } },
    }),
    prisma.locations.findUnique({ where: { id: destId }, select: { id: true, parent_id: true } }),
  ]);
  if (!current || !dest) return;
  const covers =
    current.other_locations.some((l) => l.id === destId) ||
    (!!dest.parent_id && dest.parent_id === (current.parent_id ?? current.id));
  if (covers) {
    throw new AppError(422, `Parcel ${parcel.tracking_id} is already at the hub covering its destination - deliver it instead of forwarding.`);
  }
}
