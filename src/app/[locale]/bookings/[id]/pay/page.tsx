import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { redirect } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { DEFAULT_FX_MARGIN, quoteForeignMinor } from "@/domain/fx";
import { formatKRW, formatKST, formatMinor } from "@/lib/format";
import { formatUsdReference, pickText } from "@/lib/i18n-text";
import { requireUser } from "@/server/auth/guest";
import { prisma } from "@/server/db";
import { bankTransferInfo, businessInfo } from "@/server/env";
import { getMyBooking, isBookingId } from "@/server/guest/bookings";
import { bookingRef } from "../../_components/BookingStatus";
import { getUsdKrwRate } from "@/server/fx/rates";
import { portOneConfig } from "@/server/payments/portone";
import { Countdown } from "./_components/Countdown";
import { MethodPicker, type MethodOptions } from "./_components/MethodPicker";

export async function generateMetadata({ params }: PageProps<"/[locale]/bookings/[id]/pay">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "pay" });
  return { title: t("metaTitle"), robots: { index: false } };
}

// Localized page pattern: params are read inside <Suspense> (see ../../../page.tsx).
export default function PayPage({ params }: PageProps<"/[locale]/bookings/[id]/pay">) {
  return (
    <Suspense>
      <Pay params={params} />
    </Suspense>
  );
}

/** Bank-transfer instructions in the page language, else the other language's; null when neither is set. */
function bankInstructions(locale: Locale): string | null {
  const info = bankTransferInfo();
  const [mine, other] =
    locale === "ko"
      ? [info.BANK_TRANSFER_INFO_KO, info.BANK_TRANSFER_INFO_EN]
      : [info.BANK_TRANSFER_INFO_EN, info.BANK_TRANSFER_INFO_KO];
  return mine ?? other ?? null;
}

/**
 * The online methods this deployment can take, with the exact amounts the server will charge:
 * card in KRW; PayPal in USD at today's rate plus the 2% margin (hidden when no rate is available).
 * Null when no PG is configured (bank transfer only).
 */
async function onlineMethods(firstPaymentTotal: number): Promise<{ methods: MethodOptions; fake: boolean } | null> {
  const cfg = portOneConfig();
  const hasCard = cfg.fake || Boolean(cfg.storeId && cfg.channelKeyCard && cfg.apiSecret);
  const hasPaypal = cfg.fake || Boolean(cfg.storeId && cfg.channelKeyPaypal && cfg.apiSecret);
  if (!hasCard && !hasPaypal) return null;

  const methods: MethodOptions = {};
  if (hasCard) methods.card = { amountLabel: formatKRW(firstPaymentTotal) };
  if (hasPaypal) {
    const rate = await getUsdKrwRate(prisma, new Date());
    if (rate) {
      methods.paypal = {
        amountLabel: formatMinor("USD", quoteForeignMinor(firstPaymentTotal, rate.rate, DEFAULT_FX_MARGIN)),
        rateLabel: `1 USD = ${formatKRW(Math.round(rate.rate))} (${rate.date})`,
      };
    }
  }
  return methods.card || methods.paypal ? { methods, fake: cfg.fake } : null;
}

function Amount({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "text-base font-semibold text-zinc-900" : "text-zinc-700"}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 text-right tabular-nums">
        {formatKRW(amount)} <span className="text-xs font-normal text-zinc-500">{formatUsdReference(amount)}</span>
      </dd>
    </div>
  );
}

/**
 * Payment instructions for the guest's own live payment hold (spec §11): online payment is wired in
 * phase 4, so for now the guest pays by bank transfer and the operator confirms it.
 */
async function Pay({ params }: Pick<PageProps<"/[locale]/bookings/[id]/pay">, "params">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await requireUser(isBookingId(id) ? `/${locale}/bookings/${id}/pay` : `/${locale}/bookings`);
  const [b, t] = await Promise.all([getMyBooking(prisma, user.id, id, new Date()), getTranslations("pay")]);
  if (!b) notFound();
  // Only a live hold can be paid; anything else (expired, paid, cancelled…) goes back to the booking.
  if (b.status !== "awaiting_payment" || !b.holdExpiresAt) return redirect({ href: `/bookings/${b.id}`, locale });
  const holdExpiresAt = b.holdExpiresAt;

  const online = await onlineMethods(b.price.firstPaymentTotal);
  const bank = bankInstructions(locale);
  const contact = businessInfo().BUSINESS_EMAIL;
  const ref = bookingRef(b.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t("heading")}</h1>
        <p className="break-words text-sm text-zinc-600">
          {pickText(b.house.name, locale)} · {pickText(b.room.name, locale)}
        </p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">{t("deadline", { time: formatKST(holdExpiresAt) })}</p>
        <Countdown deadline={holdExpiresAt.toISOString()} bookingId={b.id} />
      </div>

      <Card title={t("amountHeading")}>
        <dl className="flex flex-col gap-2 text-sm">
          <Amount label={t("firstRent")} amount={b.price.firstRentAmount} />
          <Amount label={t("deposit")} amount={b.price.deposit} />
          <Amount label={t("total")} amount={b.price.firstPaymentTotal} strong />
        </dl>
      </Card>

      {online && (
        <Card title={t("methodHeading")}>
          <MethodPicker
            bookingId={b.id}
            locale={locale}
            methods={online.methods}
            fake={online.fake}
            expired={false /* only a live hold reaches this page; the countdown handles expiry */}
          />
        </Card>
      )}

      <Card title={online ? t("orBank") : t("methodHeading")}>
        <div className="flex flex-col gap-3 text-sm text-zinc-700">
          {!online && <p>{t("onlineLater")}</p>}
          {bank ? (
            <>
              <p>{t("bankIntro")}</p>
              <p className="whitespace-pre-line break-words rounded-md bg-zinc-50 px-3 py-2 font-medium text-zinc-900">
                {bank}
              </p>
              <p>{t("memo", { ref })}</p>
            </>
          ) : (
            <p className="font-medium text-zinc-900">{t("noBankInfo")}</p>
          )}
          {contact && <p className="break-words">{t("contactEmail", { email: contact })}</p>}
          <p>{t("afterTransfer")}</p>
        </div>
      </Card>
    </div>
  );
}
