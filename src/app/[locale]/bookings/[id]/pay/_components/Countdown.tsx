"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";

/**
 * Time left until the payment hold expires, ticking each second in the browser. At zero it shows
 * "expired" and a link back to the booking (no auto refresh). Renders nothing until mounted, so the
 * server markup never depends on the clock; the deadline itself is printed by the server (KST).
 */
export function Countdown({ deadline, bookingId }: { deadline: string; bookingId: string }) {
  const t = useTranslations("pay");
  const end = new Date(deadline).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, end - Date.now());
      setLeft(ms);
      if (ms === 0) clearInterval(timer);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [end]);

  if (left === null) return null;
  if (left === 0) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        <p className="font-medium">{t("expired")}</p>
        <Link href={`/bookings/${bookingId}`} className="underline">
          {t("backToBooking")}
        </Link>
      </div>
    );
  }

  const s = Math.floor(left / 1000);
  return (
    <p className="text-lg font-semibold tabular-nums text-amber-900" aria-live="off">
      {t("remaining", { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 })}
    </p>
  );
}
