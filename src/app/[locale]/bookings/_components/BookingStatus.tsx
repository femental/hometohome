import { useTranslations } from "next-intl";
import { Badge, statusBadge } from "@/components/ui/Badge";
import type { BookingStatus } from "@/domain/booking-status";

/** Status badge with the guest-facing (localized) label; colours shared with the admin badge. */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("bookings.status");
  return <Badge className={statusBadge(status).className}>{t(status)}</Badge>;
}

/** Short guest-visible booking reference (first 8 hex digits of the id). */
export function bookingRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
