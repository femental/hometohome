"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { formatKRW, formatMinor } from "@/lib/format";
import { cancelAction } from "../actions/bookings";
import { labelOf, PAYMENT_METHOD_LABELS, REFUND_KIND_LABELS } from "./labels";

/** previewCancellation's result for the operator, or why the booking cannot be cancelled now. */
export type CancelPreviewData =
  | {
      ok: true;
      kind: keyof typeof REFUND_KIND_LABELS;
      amountKrw: number;
      payments: { method: string; currency: string; refundMinor: number }[];
    }
  | { ok: false; error: string };

/** "취소" reveals the refund the cancel would record; only the second button cancels. */
export function CancelPreview({ bookingId, preview }: { bookingId: string; preview: CancelPreviewData }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await cancelAction(bookingId);
      if (r.ok) setOpen(false);
      else setError(r.error ?? "취소하지 못했습니다.");
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" className="self-start text-red-700" onClick={() => setOpen(true)}>
        취소
      </Button>
    );
  }

  return (
    <section aria-label="예약 취소 미리보기" className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50/50 p-4">
      <h3 className="text-sm font-semibold text-zinc-900">예약 취소</h3>
      {preview.ok ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-zinc-500">환불</dt>
            <dd className="font-medium text-zinc-900">
              {REFUND_KIND_LABELS[preview.kind]}
              {preview.kind !== "not_allowed" && ` · ${formatKRW(preview.amountKrw)}`}
            </dd>
            {preview.payments.map((p, i) => (
              <div key={i} className="contents">
                <dt className="text-zinc-500">{labelOf(PAYMENT_METHOD_LABELS, p.method)} 결제분</dt>
                <dd className="text-zinc-900">{formatMinor(p.currency, p.refundMinor)} 환불</dd>
              </div>
            ))}
          </dl>
          {preview.payments.length === 0 && (
            <p className="text-sm text-zinc-600">결제 전 예약이라 환불할 금액이 없습니다. 방 점유만 풀립니다.</p>
          )}
          {preview.payments.some((p) => p.method === "offline") && (
            <p className="text-sm text-zinc-600">
              오프라인 결제는 직접 송금한 뒤 결제·환불 내역에서 &lsquo;환불 완료 표시&rsquo;를 눌러 주세요.
            </p>
          )}
          <p className="text-sm text-zinc-700">예약을 취소할까요? 게스트에게 취소 메일이 발송되며 되돌릴 수 없습니다.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" pending={pending} onClick={confirm}>
              취소 확정
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        </>
      ) : (
        <>
          <p role="alert" className="text-sm text-red-700">
            {preview.error}
          </p>
          <Button variant="secondary" className="self-start" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
