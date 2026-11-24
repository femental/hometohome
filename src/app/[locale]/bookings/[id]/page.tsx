import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { addDays } from "@/domain/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatDate, formatKRW, formatKST } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { getMyBooking, guestPreviewCancel, isBookingId, type GuestBookingDetail } from "@/server/guest/bookings";
import { BookingStatusBadge, bookingRef } from "../_components/BookingStatus";
import { BookingActions, type CancelPreviewView } from "./_components/BookingActions";

export async function generateMetadata({ params }: PageProps<"/[locale]/bookings/[id]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "bookings" });
  return { title: t("detailTitle"), robots: { index: false } };
}

// Localized page pattern: params are read inside <Suspense> (see ../../page.tsx).
export default function BookingPage({ params }: PageProps<"/[locale]/bookings/[id]">) {
  return (
    <Suspense>
      <BookingDetail params={params} />
    </Suspense>
  );
}

function Amount({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 text-right tabular-nums">
        {formatKRW(amount)} <span className="text-xs font-normal text-zinc-500">{formatUsdReference(amount)}</span>
      </dd>
    </div>
  );
}

async function BookingDetail({ params }: Pick<PageProps<"/[locale]/bookings/[id]">, "params">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await requireUser(isBookingId(id) ? `/${locale}/bookings/${id}` : `/${locale}/bookings`);
  const now = new Date();
  const [b, t, tRequest] = await Promise.all([
    getMyBooking(prisma, user.id, id, now),
    getTranslations("bookings"),
    getTranslations("request"),
  ]);
  if (!b) notFound(); // someone else's booking looks exactly like a missing one

  let preview: CancelPreviewView | null = null;
  if (b.status === "confirmed") {
    const p = await guestPreviewCancel(prisma, user.id, b.id, now);
    const payment = p?.payments[0];
    preview = p && {
      kind: p.kind,
      amountKrw: p.amountKrw,
      charged: payment && payment.currency !== "KRW" ? { currency: payment.currency, minor: payment.refundMinor } : null,
    };
  }
  const mode = b.status === "requested" ? "withdraw" : b.status === "confirmed" ? "cancel" : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/bookings" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← {t("backToList")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold text-zinc-900">{pickText(b.house.name, locale)}</h1>
          <p className="break-words text-sm text-zinc-600">{pickText(b.room.name, locale)}</p>
          <p className="mt-1 text-xs text-zinc-500">{t("reference", { ref: bookingRef(b.id) })}</p>
        </div>
        <BookingStatusBadge status={b.status} />
      </div>

      <StatusNotice booking={b} locale={locale} />

      <BookingActions bookingId={b.id} mode={mode} preview={preview} />

      <Card title={t("stayHeading")}>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-600">{t("moveIn")}</dt>
            <dd className="text-right text-zinc-900">{formatDate(b.moveIn, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-600">{t("lastNight")}</dt>
            <dd className="text-right text-zinc-900">{formatDate(b.lastNight, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-600">{t("guestsLabel")}</dt>
            <dd className="min-w-0 break-words text-right text-zinc-900">
              {[b.guestName, b.coOccupantName].filter(Boolean).join(", ")}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={t("priceHeading")}>
        <dl className="flex flex-col gap-2 text-sm">
          <Amount label={tRequest("monthlyRent")} amount={b.price.monthlyRent} />
          <Amount
            label={`${tRequest("stayTotal")} · ${tRequest("stayLength", { months: b.price.fullMonths, days: b.price.extraDays })}`}
            amount={b.price.stayTotal}
          />
          <Amount label={tRequest("firstRent")} amount={b.price.firstRentAmount} />
          <Amount label={tRequest("deposit")} amount={b.price.deposit} />
          <Amount label={tRequest("firstPayment")} amount={b.price.firstPaymentTotal} strong />
        </dl>
        <p className="mt-2 text-xs text-zinc-500">{t("priceNote")}</p>
        {(b.status === "requested" || b.status === "awaiting_payment" || b.status === "confirmed") && (
          <p className="mt-2 text-xs text-zinc-500">
            {tRequest("cancellation", { date: formatDate(addDays(b.moveIn, -7), locale) })}
          </p>
        )}
      </Card>
    </div>
  );
}

async function StatusNotice({ booking: b, locale }: { booking: GuestBookingDetail; locale: "en" | "ko" }) {
  const t = await getTranslations({ locale, namespace: "bookings" });
  const box = "flex flex-col gap-3 rounded-lg border p-4 text-sm";

  switch (b.status) {
    case "requested":
      return (
        <div className={`${box} border-blue-200 bg-blue-50 text-blue-900`}>
          <p>{t("notice.requested", { time: b.requestExpiresAt ? formatKST(b.requestExpiresAt) : "—" })}</p>
        </div>
      );
    case "awaiting_payment":
      return (
        <div className={`${box} border-amber-200 bg-amber-50 text-amber-900`}>
          <p>{t("notice.awaiting_payment", { time: b.holdExpiresAt ? formatKST(b.holdExpiresAt) : "—" })}</p>
          <div>
            <Link
              href={`/bookings/${b.id}/pay`}
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              {t("payNow")}
            </Link>
          </div>
        </div>
      );
    case "confirmed":
    case "completed":
      return (
        <div className={`${box} border-green-200 bg-green-50 text-green-900`}>
          <p>{t(`notice.${b.status}`)}</p>
        </div>
      );
    case "cancelled":
      return (
        <div className={`${box} border-zinc-200 bg-zinc-50 text-zinc-800`}>
          <p>{t("notice.cancelled")}</p>
          {b.refunds.map((r, i) => (
            <p key={i}>
              {t("refundLine", {
                amount: formatKRW(r.amountKrw),
                status: t(`refundStatus.${r.status === "done" || r.status === "failed" ? r.status : "pending"}`),
              })}
            </p>
          ))}
        </div>
      );
    default:
      return (
        <div className={`${box} border-zinc-200 bg-zinc-50 text-zinc-800`}>
          <p>{t(`notice.${b.status}`)}</p>
        </div>
      );
  }
}
