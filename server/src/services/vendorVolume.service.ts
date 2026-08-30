import prisma from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";

// Single row, upserted rather than enforced by a DB constraint - same
// approach as pricing_settings/billing_settings. Read/write always target
// this one row.
const SETTINGS_ROW_ID = "00000000-0000-0000-0000-000000000001";

const DEFAULT_DAILY_LIMIT = 100;

export type VendorVolumeSettings = { highVolumeDailyParcels: number };

/** The configured daily-parcel threshold, creating the singleton row on first read. */
export async function getVendorVolumeSettings(): Promise<VendorVolumeSettings> {
  const row = await prisma.vendor_volume_settings.upsert({
    where: { id: SETTINGS_ROW_ID },
    create: { id: SETTINGS_ROW_ID, high_volume_daily_parcels: DEFAULT_DAILY_LIMIT },
    update: {},
  });
  return { highVolumeDailyParcels: row.high_volume_daily_parcels };
}

export async function updateVendorVolumeSettings(dailyLimit: number): Promise<VendorVolumeSettings> {
  if (!Number.isFinite(dailyLimit) || dailyLimit < 1) {
    throw new AppError(400, "Daily parcel limit must be a positive number");
  }
  const limit = Math.round(dailyLimit);
  const row = await prisma.vendor_volume_settings.upsert({
    where: { id: SETTINGS_ROW_ID },
    create: { id: SETTINGS_ROW_ID, high_volume_daily_parcels: limit },
    update: { high_volume_daily_parcels: limit },
  });
  return { highVolumeDailyParcels: row.high_volume_daily_parcels };
}

/**
 * Which of the given vendors have ever had a single calendar day's parcel
 * count exceed the configured threshold, busiest peak day first.
 *
 * A lifetime total does not tell you this - a vendor who has shipped 5/day for
 * two years has a bigger total than one who did 150 in a single day last
 * month, but it's the second vendor operations actually needs to see coming.
 */
export async function rankHighVolumeVendors(candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const { highVolumeDailyParcels } = await getVendorVolumeSettings();

  // Grouped on created_at shifted into Nepal local time, not raw UTC - same
  // convention as formatNepalDate/nepalDayRangeUtc, so a "day" here means the
  // same thing it does everywhere else records get bucketed by day.
  const rows = await prisma.$queryRaw<Array<{ vendor_id: string; peak_daily_count: number }>>(Prisma.sql`
    SELECT vendor_id, MAX(daily_count)::int AS peak_daily_count
    FROM (
      SELECT vendor_id, date_trunc('day', created_at + interval '5 hours 45 minutes') AS day, COUNT(*) AS daily_count
      FROM parcels
      WHERE vendor_id = ANY(${candidateIds}::uuid[]) AND deleted_at IS NULL
      GROUP BY vendor_id, day
    ) daily
    GROUP BY vendor_id
    HAVING MAX(daily_count) > ${highVolumeDailyParcels}
    ORDER BY peak_daily_count DESC
  `);

  return rows.map((row) => row.vendor_id);
}
