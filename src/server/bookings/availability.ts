import { effectiveStatus, OCCUPYING_STATUSES } from "@/domain/booking-status";
import type { ISODate } from "@/domain/dates";
import type { Db } from "@/server/db";

export const toDbDate = (iso: ISODate) => new Date(`${iso}T00:00:00Z`);
export const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);

/**
 * True when no room block and no occupying booking overlaps `[moveIn, moveOut)`.
 * A hold whose expiry has passed does not occupy, even before the cron persists it.
 *
 * Advisory only: the `booking_no_overlap` exclusion constraint is what guarantees
 * no double booking under concurrency.
 */
export async function isRoomFree(
  db: Db,
  roomId: string,
  moveIn: ISODate,
  moveOut: ISODate,
  now: Date,
  excludeBookingId?: string,
): Promise<boolean> {
  const start = toDbDate(moveIn);
  const end = toDbDate(moveOut);

  const block = await db.roomBlock.findFirst({
    where: { roomId, startDate: { lt: end }, endDateExclusive: { gt: start } },
    select: { id: true },
  });
  if (block) return false;

  const overlapping = await db.booking.findMany({
    where: {
      roomId,
      status: { in: [...OCCUPYING_STATUSES] },
      moveIn: { lt: end },
      moveOut: { gt: start },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { status: true, requestExpiresAt: true, holdExpiresAt: true },
  });
  return !overlapping.some((b) => OCCUPYING_STATUSES.includes(effectiveStatus(b, now)));
}
