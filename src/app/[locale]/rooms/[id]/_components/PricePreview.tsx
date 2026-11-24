"use client";

import { useLocale, useTranslations } from "next-intl";
import { addDays, type ISODate } from "@/domain/dates";
import type { PriceQuote } from "@/domain/pricing";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatKRW } from "@/lib/format";
import { formatUsdReference } from "@/lib/i18n-text";
import { guestErrorMessageKey, type GuestErrorKey } from "@/server/guest/errors";

export type PreviewState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "quote"; quote: PriceQuote }
  | { kind: "error"; error: GuestErrorKey };

function Row({ label, amount, hint, strong = false }: { label: string; amount: number; hint?: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-baseline justify-between gap-3 ${strong ? "text-base font-semibold text-zinc-900" : "text-sm text-zinc-700"}`}>
        <dt className="min-w-0">{label}</dt>
        <dd className="shrink-0 text-right tabular-nums">
          {formatKRW(amount)} <span className="text-xs font-normal text-zinc-500">{formatUsdReference(amount)}</span>
        </dd>
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * Server-computed price for the chosen stay (spec §8): monthly and prorated parts, first payment
 * (first rent + deposit), and the cancellation rule (spec §9). Never computes prices itself.
 */
export function PricePreview({ state, moveIn }: { state: PreviewState; moveIn: ISODate }) {
  const t = useTranslations("request");
  const tRoot = useTranslations();
  const locale = useLocale() as Locale;

  return (
    <section aria-labelledby="price-preview-heading" aria-live="polite" className="flex flex-col gap-3 rounded-lg bg-zinc-50 p-4">
      <h3 id="price-preview-heading" className="text-sm font-semibold text-zinc-900">
        {t("previewHeading")}
      </h3>
      {state.kind === "empty" && <p className="text-sm text-zinc-600">{t("enterDates")}</p>}
      {state.kind === "loading" && <p className="text-sm text-zinc-600">{t("calculating")}</p>}
      {state.kind === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {tRoot(guestErrorMessageKey(state.error))}
        </p>
      )}
      {state.kind === "quote" && <Breakdown quote={state.quote} moveIn={moveIn} locale={locale} />}
    </section>
  );
}

function Breakdown({ quote: q, moveIn, locale }: { quote: PriceQuote; moveIn: ISODate; locale: Locale }) {
  const t = useTranslations("request");
  return (
    <>
      <p className="text-sm font-medium text-zinc-900">{t("stayLength", { months: q.fullMonths, days: q.extraDays })}</p>
      <dl className="flex flex-col gap-2">
        <Row
          label={t("monthlyRent")}
          amount={q.appliedMonthlyRent}
          hint={t("monthsLine", { months: q.fullMonths, rent: formatKRW(q.appliedMonthlyRent) })}
        />
        {q.extraDays > 0 && <Row label={t("prorated", { days: q.extraDays })} amount={q.proratedAmount} />}
        <Row label={t("stayTotal")} amount={q.stayTotal} strong />
      </dl>
      <hr className="border-zinc-200" />
      <dl className="flex flex-col gap-2">
        <Row
          label={t("firstRent")}
          amount={q.firstRentAmount}
          hint={q.fullMonths === 1 ? t("firstRentShort") : t("firstRentLong")}
        />
        <Row label={t("deposit")} amount={q.deposit} />
        <Row label={t("firstPayment")} amount={q.firstPaymentTotal} strong />
      </dl>
      <p className="text-xs text-zinc-600">{t("noChargeYet")}</p>
      <p className="text-xs text-zinc-600">{t("cancellation", { date: formatDate(addDays(moveIn, -7), locale) })}</p>
    </>
  );
}
