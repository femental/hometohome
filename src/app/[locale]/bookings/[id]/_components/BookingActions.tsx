"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { formatKRW, formatMinor } from "@/lib/format";
import { formatUsdReference } from "@/lib/i18n-text";
import { guestErrorMessageKey, type GuestErrorKey } from "@/server/guest/errors";
import { cancelAction, withdrawAction } from "../../actions";

/** The server's cancellation preview, reduced to what the guest sees. */
export type CancelPreviewView = {
  kind: "full" | "deposit_only" | "not_allowed";
  amountKrw: number;
  /** Set when the payment was charged in another currency (e.g. USD minor units). */
  charged: { currency: string; minor: number } | null;
};

type Outcome = { kind: "withdrawn" } | { kind: "cancelled"; refundKrw: number } | { kind: "error"; error: GuestErrorKey };

/**
 * Withdraw (requested) or cancel (confirmed) with a confirm step. Rendered at a fixed place on the
 * page so its success notice survives the re-render that follows the action (the controls go away
 * once the status changes). Amounts all come from the server.
 */
export function BookingActions({
  bookingId,
  mode,
  preview,
}: {
  bookingId: string;
  mode: "withdraw" | "cancel" | null;
  preview: CancelPreviewView | null;
}) {
  const t = useTranslations("bookings");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      if (mode === "withdraw") {
        const r = await withdrawAction(bookingId, locale);
        setOutcome(r.ok ? { kind: "withdrawn" } : { kind: "error", error: r.error });
      } else {
        const r = await cancelAction(bookingId, locale);
        setOutcome(r.ok ? { kind: "cancelled", refundKrw: r.refundKrw } : { kind: "error", error: r.error });
      }
      setConfirming(false);
    });
  }

  const errorText = (e: GuestErrorKey) => (e === "NOT_FOUND" ? t("notFound") : tRoot(guestErrorMessageKey(e)));
  const canCancel = mode === "cancel" && preview !== null && preview.kind !== "not_allowed";

  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {outcome && outcome.kind !== "error" && (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {outcome.kind === "withdrawn"
            ? t("withdrawDone")
            : outcome.refundKrw > 0
              ? t("cancelDone", { amount: formatKRW(outcome.refundKrw) })
              : t("cancelDoneNoRefund")}
        </p>
      )}
      {outcome?.kind === "error" && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorText(outcome.error)}
        </p>
      )}

      {mode === "cancel" && preview && (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-base font-semibold text-zinc-900">{t("cancelHeading")}</h2>
          <p className="text-sm text-zinc-700">
            {preview.kind === "not_allowed"
              ? t("refundPreview.not_allowed")
              : t(`refundPreview.${preview.kind}`, { amount: formatKRW(preview.amountKrw) })}{" "}
            {preview.kind !== "not_allowed" && !preview.charged && (
              <span className="text-xs text-zinc-500">{formatUsdReference(preview.amountKrw)}</span>
            )}
          </p>
          {preview.kind !== "not_allowed" && preview.charged && (
            <p className="text-sm text-zinc-700">
              {t("refundCharged", { amount: formatMinor(preview.charged.currency, preview.charged.minor) })}
            </p>
          )}
          <Link href="/refund-policy" className="text-sm text-blue-700 underline">
            {t("refundPolicy")}
          </Link>
        </section>
      )}

      {(mode === "withdraw" || canCancel) &&
        (confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-900">
              {mode === "withdraw" ? t("withdrawConfirm") : t("cancelConfirm")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" pending={pending} onClick={run}>
                {mode === "withdraw" ? t("withdrawYes") : t("cancelYes")}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
                {t("keep")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setOutcome(null);
                setConfirming(true);
              }}
            >
              {mode === "withdraw" ? t("withdraw") : t("cancel")}
            </Button>
          </div>
        ))}
    </div>
  );
}
