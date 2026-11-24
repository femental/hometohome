"use client";

import PortOne from "@portone/browser-sdk/v2";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { completePaymentAction, fakeCheckoutAction, preparePaymentAction, type PrepareResult } from "../actions";

export type MethodOptions = {
  card?: { amountLabel: string };
  paypal?: { amountLabel: string; rateLabel: string };
};

type Status = "idle" | "processing" | "paypal" | "error";

/**
 * Card (KRW) and PayPal (USD) checkout. Every amount comes from the server: the button asks
 * `preparePaymentAction` for the payment row, opens PortOne with exactly those values, and the
 * result is verified server-side (`completePaymentAction`) before the complete page shows it.
 */
export function MethodPicker({
  bookingId,
  locale,
  methods,
  fake,
  expired,
}: {
  bookingId: string;
  locale: "en" | "ko";
  methods: MethodOptions;
  fake: boolean;
  expired: boolean;
}) {
  const t = useTranslations("pay");
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const paypalBox = useRef<HTMLDivElement>(null);
  const busy = status === "processing";

  const fail = (key: "failed" | "unavailable" | "fxUnavailable") => {
    setStatus("error");
    setMessage(t(key));
  };
  const toComplete = (paymentId: string) =>
    router.push({ pathname: `/bookings/${bookingId}/pay/complete`, query: { paymentId } });

  async function prepare(method: "card" | "paypal") {
    setStatus("processing");
    setMessage(null);
    const res: PrepareResult = await preparePaymentAction(bookingId, method, locale);
    if (!res.ok) {
      if (res.error === "FX_UNAVAILABLE") fail("fxUnavailable");
      else if (res.error === "INVALID_STATE" || res.error === "NOT_FOUND") router.refresh();
      else fail("unavailable");
      return null;
    }
    return res.payment;
  }

  async function payByCard() {
    const p = await prepare("card");
    if (!p) return;
    if (fake) {
      await fakeCheckoutAction(p.paymentId, locale);
      return toComplete(p.paymentId);
    }
    const res = await PortOne.requestPayment({
      storeId: p.storeId,
      channelKey: p.channelKey,
      paymentId: p.paymentId,
      orderName: p.orderName,
      totalAmount: p.totalAmount,
      currency: p.currency,
      payMethod: "CARD",
      customer: p.customer,
      redirectUrl: p.redirectUrl,
      locale: locale === "ko" ? "KO_KR" : "EN_US",
    });
    // A response with a `code` is a failure or a closed window; nothing was charged.
    if (!res || res.code !== undefined) return fail("failed");
    await completePaymentAction(p.paymentId, locale);
    toComplete(p.paymentId);
  }

  async function payByPaypal() {
    const p = await prepare("paypal");
    if (!p) return;
    if (fake) {
      await fakeCheckoutAction(p.paymentId, locale);
      return toComplete(p.paymentId);
    }
    setStatus("paypal");
    await PortOne.loadPaymentUI(
      {
        uiType: "PAYPAL_SPB",
        storeId: p.storeId,
        channelKey: p.channelKey,
        paymentId: p.paymentId,
        orderName: p.orderName,
        totalAmount: p.totalAmount,
        currency: p.currency,
        customer: p.customer,
      },
      {
        onPaymentSuccess: async () => {
          setStatus("processing");
          await completePaymentAction(p.paymentId, locale);
          toComplete(p.paymentId);
        },
        onPaymentFail: () => fail("failed"),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {fake && <p className="rounded-md bg-sky-50 px-3 py-2 text-sky-900">{t("testMode")}</p>}

      {methods.card && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-zinc-900 tabular-nums">{methods.card.amountLabel}</span>
            <Button onClick={payByCard} disabled={expired || busy} pending={busy}>
              {t("payCard")}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">{t("cardNote")}</p>
        </div>
      )}

      {methods.paypal && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-zinc-900 tabular-nums">{methods.paypal.amountLabel}</span>
            <Button variant="secondary" onClick={payByPaypal} disabled={expired || busy || status === "paypal"}>
              {t("payPaypal")}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">{t("paypalNote", { rate: methods.paypal.rateLabel })}</p>
          {status === "paypal" && <p className="text-xs text-zinc-700">{t("paypalHint")}</p>}
          <div ref={paypalBox} className="portone-ui-container" data-portone-ui-type="paypal-spb" />
        </div>
      )}

      {busy && <p className="text-zinc-600">{t("processing")}</p>}
      {message && (
        <p role="alert" className="text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}
