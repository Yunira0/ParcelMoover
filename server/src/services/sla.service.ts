import prisma from "../lib/prisma";
import { parcel_status } from "../generated/prisma/client";

// Per-status SLA thresholds (hours). Statuses are grouped for display and for
// the dashboard "Needs attention" rollup. 'remarks' and 'return' are special
// singleton keys (remarks aren't a parcel status; 'return' covers the whole
// return workflow with one threshold).
export const SLA_GROUPS = {
  pickup: ["pickup_ordered", "rider_assigned", "picked_up", "arrived"],
  delivery: ["ready_to_deliver", "sent_for_delivery"],
  transit: ["oov", "dispatched", "arrived_at_branch"],
  return: ["follow_up", "ready_to_return", "sent_to_vendor"],
} as const satisfies Record<string, parcel_status[]>;

// Every configurable key, in a stable order.
export const SLA_STATUS_KEYS: string[] = [
  ...SLA_GROUPS.pickup,
  ...SLA_GROUPS.delivery,
  ...SLA_GROUPS.transit,
  ...SLA_GROUPS.return,
  "remarks",
];

// Defaults used to backfill any key missing from the table on first read.
const DEFAULT_HOURS: Record<string, number> = {
  pickup_ordered: 24,
  rider_assigned: 24,
  picked_up: 24,
  arrived: 24,
  ready_to_deliver: 24,
  sent_for_delivery: 24,
  oov: 48,
  dispatched: 48,
  arrived_at_branch: 48,
  follow_up: 72,
  ready_to_return: 72,
  sent_to_vendor: 72,
  remarks: 24,
};

export type SlaSettings = Record<string, number | null>;

// Returns the SLA map for every configurable key. Creates any missing rows with
// their default so the settings screen always has a full set to render.
export async function getSlaSettings(): Promise<SlaSettings> {
  const rows = await prisma.sla_settings.findMany();
  const map: SlaSettings = {};
  for (const row of rows) map[row.status_key] = row.sla_hours;

  const missing = SLA_STATUS_KEYS.filter((k) => !(k in map));
  if (missing.length) {
    await prisma.sla_settings.createMany({
      data: missing.map((k) => ({ status_key: k, sla_hours: DEFAULT_HOURS[k] ?? null })),
      skipDuplicates: true,
    });
    for (const k of missing) map[k] = DEFAULT_HOURS[k] ?? null;
  }

  // Only expose known keys, in stable order.
  const result: SlaSettings = {};
  for (const k of SLA_STATUS_KEYS) result[k] = map[k] ?? null;
  return result;
}

// Upserts each provided key. Values must be a non-negative integer or null
// (null disables the SLA for that key). Unknown keys are ignored.
export async function updateSlaSettings(input: SlaSettings): Promise<SlaSettings> {
  const entries = Object.entries(input).filter(([key]) => SLA_STATUS_KEYS.includes(key));

  await prisma.$transaction(
    entries.map(([key, value]) => {
      const hours = value === null || value === undefined ? null : Math.max(0, Math.round(Number(value)));
      return prisma.sla_settings.upsert({
        where: { status_key: key },
        create: { status_key: key, sla_hours: hours },
        update: { sla_hours: hours },
      });
    }),
  );

  return getSlaSettings();
}
