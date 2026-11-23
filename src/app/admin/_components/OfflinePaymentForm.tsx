"use client";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { formatKRW } from "@/lib/format";
import { confirmOfflineAction } from "../actions/bookings";
import { FormMessage, useActionForm, useFieldIds } from "./form-utils";
import { OFFLINE_METHOD_LABELS } from "./labels";

/** Records money received outside the PG (spec §11) and confirms an `awaiting_payment` booking. */
export function OfflinePaymentForm({ bookingId, firstPaymentTotal }: { bookingId: string; firstPaymentTotal: number }) {
  const { state, pending, onSubmit, fieldError } = useActionForm(confirmOfflineAction.bind(null, bookingId));
  const fieldId = useFieldIds();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
      <h3 className="text-sm font-semibold text-zinc-900">오프라인 결제 확인</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field as="select" label="결제 수단" id={fieldId("method")} name="method" defaultValue="bank_transfer" error={fieldError("method")}>
          {Object.entries(OFFLINE_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Field>
        <Field
          label="받은 금액 (원)"
          id={fieldId("amountKrw")}
          name="amountKrw"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          defaultValue={firstPaymentTotal}
          hint={`첫 결제 금액 ${formatKRW(firstPaymentTotal)}과 같아야 합니다.`}
          error={fieldError("amountKrw")}
        />
      </div>
      <Field
        as="textarea"
        rows={2}
        label="메모"
        id={fieldId("note")}
        name="note"
        maxLength={500}
        placeholder="입금자명, 입금 시각 등"
        error={fieldError("note")}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" pending={pending}>
          결제 확인 (예약 확정)
        </Button>
        <div className="flex-1">
          <FormMessage state={state} success="결제를 확인하고 예약을 확정했습니다." />
        </div>
      </div>
    </form>
  );
}
