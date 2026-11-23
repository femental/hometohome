"use client";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { BookingStatus } from "@/domain/booking-status";
import type { ISODate } from "@/domain/dates";
import { approveAction, completeAction, depositReturnedAction, rejectAction } from "../actions/bookings";
import { CancelPreview, type CancelPreviewData } from "./CancelPreview";
import { ConfirmButton } from "./ConfirmButton";
import { FormMessage, useActionForm, useFieldIds } from "./form-utils";
import { OfflinePaymentForm } from "./OfflinePaymentForm";

/**
 * The operator's next steps for a booking: only the ones its effective status allows.
 * The server re-checks every step; this only keeps invalid buttons off the screen.
 */
export function BookingActions({
  bookingId,
  status,
  moveIn,
  canComplete,
  depositReturned,
  firstPaymentTotal,
  cancelPreview,
}: {
  bookingId: string;
  status: BookingStatus;
  moveIn: ISODate;
  /** Today (KST) is on or after the move-in day. */
  canComplete: boolean;
  depositReturned: boolean;
  firstPaymentTotal: number;
  cancelPreview: CancelPreviewData | null;
}) {
  switch (status) {
    case "requested":
      return (
        <div className="flex flex-col gap-4">
          <ConfirmButton
            tone="neutral"
            label="승인"
            question="승인할까요? 게스트에게 결제 링크 메일이 가고 24시간 동안 방이 잡힙니다."
            confirmLabel="승인"
            onConfirm={() => approveAction(bookingId)}
          />
          <RejectForm bookingId={bookingId} />
        </div>
      );
    case "awaiting_payment":
      return (
        <div className="flex flex-col gap-4">
          <OfflinePaymentForm bookingId={bookingId} firstPaymentTotal={firstPaymentTotal} />
          {cancelPreview && <CancelPreview bookingId={bookingId} preview={cancelPreview} />}
        </div>
      );
    case "confirmed":
      return (
        <div className="flex flex-col gap-4">
          {cancelPreview && <CancelPreview bookingId={bookingId} preview={cancelPreview} />}
          {canComplete ? (
            <ConfirmButton
              tone="neutral"
              label="퇴실 완료"
              question="퇴실 완료로 표시할까요?"
              confirmLabel="퇴실 완료"
              onConfirm={() => completeAction(bookingId)}
            />
          ) : (
            <p className="text-sm text-zinc-500">입주일({moveIn})부터 퇴실 완료로 표시할 수 있습니다.</p>
          )}
        </div>
      );
    case "completed":
      return depositReturned ? (
        <p className="text-sm text-zinc-500">보증금 반환까지 끝난 예약입니다.</p>
      ) : (
        <DepositReturnedForm bookingId={bookingId} />
      );
    default:
      return <p className="text-sm text-zinc-500">이 상태에서는 할 수 있는 작업이 없습니다.</p>;
  }
}

function RejectForm({ bookingId }: { bookingId: string }) {
  const { state, pending, onSubmit, fieldError } = useActionForm(rejectAction.bind(null, bookingId));
  const fieldId = useFieldIds();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
      <h3 className="text-sm font-semibold text-zinc-900">거절</h3>
      <Field
        as="textarea"
        rows={2}
        label="거절 사유 (게스트에게 메일로 전달됩니다)"
        id={fieldId("reason")}
        name="reason"
        maxLength={500}
        error={fieldError("reason")}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="danger" className="self-start" pending={pending}>
          거절
        </Button>
        <div className="flex-1">
          <FormMessage state={state} success="신청을 거절했습니다." />
        </div>
      </div>
    </form>
  );
}

function DepositReturnedForm({ bookingId }: { bookingId: string }) {
  const { state, pending, onSubmit, fieldError } = useActionForm(depositReturnedAction.bind(null, bookingId));
  const fieldId = useFieldIds();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
      <h3 className="text-sm font-semibold text-zinc-900">보증금 반환</h3>
      <Field
        as="textarea"
        rows={2}
        label="메모"
        id={fieldId("note")}
        name="note"
        maxLength={500}
        placeholder="반환 금액, 공제 내역, 송금일 등"
        error={fieldError("note")}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" className="self-start" pending={pending}>
          보증금 반환 표시
        </Button>
        <div className="flex-1">
          <FormMessage state={state} success="보증금 반환을 기록했습니다." />
        </div>
      </div>
    </form>
  );
}
