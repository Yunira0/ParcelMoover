import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

export interface PickupTimeSlotDTO {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  cutoffMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

function formatMinutes(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function toDTO(row: {
  id: string;
  start_minutes: number;
  end_minutes: number;
  is_active: boolean;
  sort_order: number;
}): PickupTimeSlotDTO {
  return {
    id: row.id,
    label: `${formatMinutes(row.start_minutes)} – ${formatMinutes(row.end_minutes)}`,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    // Slots close 1 hour before they end, same as the old hardcoded rule.
    cutoffMinutes: Math.max(row.start_minutes, row.end_minutes - 60),
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function listActivePickupTimeSlots(): Promise<PickupTimeSlotDTO[]> {
  const rows = await prisma.pickup_time_slots.findMany({
    where: { is_active: true },
    orderBy: { sort_order: "asc" },
  });
  return rows.map(toDTO);
}

export async function listAllPickupTimeSlots(): Promise<PickupTimeSlotDTO[]> {
  const rows = await prisma.pickup_time_slots.findMany({ orderBy: { sort_order: "asc" } });
  return rows.map(toDTO);
}

function assertValidRange(start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new AppError(400, "Start and end time must be valid times");
  }
  if (start < 0 || end > 1440 || start >= end) {
    throw new AppError(400, "End time must be after start time");
  }
}

export async function createPickupTimeSlot(input: {
  startMinutes: number;
  endMinutes: number;
}): Promise<PickupTimeSlotDTO> {
  assertValidRange(input.startMinutes, input.endMinutes);

  const maxOrder = await prisma.pickup_time_slots.aggregate({ _max: { sort_order: true } });
  const row = await prisma.pickup_time_slots.create({
    data: {
      start_minutes: input.startMinutes,
      end_minutes: input.endMinutes,
      sort_order: (maxOrder._max.sort_order ?? -1) + 1,
    },
  });
  return toDTO(row);
}

export async function updatePickupTimeSlot(
  id: string,
  input: { startMinutes?: number; endMinutes?: number; isActive?: boolean },
): Promise<PickupTimeSlotDTO> {
  const existing = await prisma.pickup_time_slots.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Pickup time slot not found");

  const start = input.startMinutes ?? existing.start_minutes;
  const end = input.endMinutes ?? existing.end_minutes;
  assertValidRange(start, end);

  const row = await prisma.pickup_time_slots.update({
    where: { id },
    data: {
      start_minutes: start,
      end_minutes: end,
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    },
  });
  return toDTO(row);
}

export async function deletePickupTimeSlot(id: string): Promise<void> {
  const existing = await prisma.pickup_time_slots.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Pickup time slot not found");
  await prisma.pickup_time_slots.delete({ where: { id } });
}
