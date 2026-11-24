"use client";

import { Badge } from "@/components/ui/Badge";
import { formatKRW, formatKST, formatMinor } from "@/lib/format";
import { markRefundDoneAction, retryRefundAction } from "../actions/bookings";
import { ConfirmButton } from "./ConfirmButton";
import {
  labelOf,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_REASON_LABELS,
  REFUND_STATUS_LABELS,
} from "./labels";

export type PaymentItem = {
  id: string;
  method: string;
  currency: string;
  amountKrw: number;
  amountChargedMinor: number;
  fxRate: string | null;
  status: string;
  offlineNote: string | null;
  paidAt: Date | null;
  createdAt: Date;
  refunds: {
    id: string;
    reason: string;
    amountKrw: number;
    amountRefundedMinor: number;
    status: string;
    manual: boolean;
    createdAt: Date;
  }[];
};

const REFUND_STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

/** Payments of a booking with their refunds; a pending manual refund can be marked as sent. */
export function RefundList({ payments }: { payments: PaymentItem[] }) {
  if (payments.length === 0) return <p className="text-sm text-zinc-500">결제 내역이 없습니다.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {payments.map((p) => (
        <li key={p.id} className="rounded-md border border-zinc-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-zinc-900">{labelOf(PAYMENT_METHOD_LABELS, p.method)}</span>
            <span className="text-zinc-900">
              {formatKRW(p.amountKrw)}
              {p.currency !== "KRW" && ` (청구 ${formatMinor(p.currency, p.amountChargedMinor)}, 환율 ${p.fxRate ?? "-"})`}
            </span>
            <Badge className="bg-zinc-100 text-zinc-700">{labelOf(PAYMENT_STATUS_LABELS, p.status)}</Badge>
            <span className="text-xs text-zinc-500">{formatKST(p.paidAt ?? p.createdAt)}</span>
          </div>
          {p.offlineNote && <p className="mt-1 text-xs text-zinc-500">메모: {p.offlineNote}</p>}

          {p.refunds.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3">
              {p.refunds.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-zinc-700">환불 · {labelOf(REFUND_REASON_LABELS, r.reason)}</span>
                    <span className="text-zinc-900">
                      {formatKRW(r.amountKrw)}
                      {p.currency !== "KRW" && ` (${formatMinor(p.currency, r.amountRefundedMinor)})`}
                    </span>
                    <Badge className={REFUND_STATUS_CLASS[r.status] ?? "bg-zinc-100 text-zinc-700"}>
                      {labelOf(REFUND_STATUS_LABELS, r.status)}
                    </Badge>
                    {r.manual && <span className="text-xs text-zinc-500">직접 송금</span>}
                    <span className="text-xs text-zinc-500">{formatKST(r.createdAt)}</span>
                  </div>
                  {r.manual && r.status === "pending" && (
                    <ConfirmButton
                      size="sm"
                      tone="neutral"
                      label="환불 완료 표시"
                      question="게스트에게 송금을 마쳤나요?"
                      confirmLabel="완료로 표시"
                      onConfirm={() => markRefundDoneAction(r.id)}
                    />
                  )}
                  {!r.manual && r.status !== "done" && (
                    <ConfirmButton
                      size="sm"
                      tone="neutral"
                      label="환불 재시도"
                      question="결제 대행사(PortOne)에 환불을 다시 요청할까요?"
                      confirmLabel="재시도"
                      onConfirm={() => retryRefundAction(r.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
