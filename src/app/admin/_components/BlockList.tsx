"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { addDays, type ISODate } from "@/domain/dates";
import { createBlockAction, deleteBlockAction } from "../actions/catalog";
import { ConfirmButton } from "./ConfirmButton";
import { FormMessage, useActionForm, useFieldIds } from "./form-utils";

export type BlockItem = { id: string; startDate: ISODate; endDateExclusive: ISODate; reason: string | null };

/** Blocked periods of a room. A block covers startDate up to (not including) endDateExclusive. */
export function BlockList({ roomId, blocks }: { roomId: string; blocks: BlockItem[] }) {
  const { state, pending, onSubmit, fieldError } = useActionForm(createBlockAction.bind(null, roomId));
  const fieldId = useFieldIds();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <p className="text-sm text-zinc-500">차단된 기간이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white">
          {blocks.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="text-zinc-900">
                  {b.startDate} ~ {addDays(b.endDateExclusive, -1)}
                  <span className="ml-2 text-xs text-zinc-500">({b.endDateExclusive}부터 예약 가능)</span>
                </p>
                {b.reason && <p className="text-xs text-zinc-500">{b.reason}</p>}
              </div>
              <ConfirmButton
                size="sm"
                label="차단 해제"
                question="이 차단을 해제할까요?"
                confirmLabel="해제"
                onConfirm={() => deleteBlockAction(b.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3">
        <h3 className="text-sm font-semibold text-zinc-900">차단 기간 추가</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="시작일" id={fieldId("startDate")} name="startDate" type="date" error={fieldError("startDate")} />
          <Field
            label="해제일 (이 날부터 예약 가능)"
            id={fieldId("endDateExclusive")}
            name="endDateExclusive"
            type="date"
            error={fieldError("endDateExclusive")}
          />
          <Field label="사유" id={fieldId("reason")} name="reason" placeholder="수리, 개인 사용 등" error={fieldError("reason")} />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" variant="secondary" pending={pending}>
            차단 추가
          </Button>
          <div className="flex-1">
            <FormMessage state={state} success="차단 기간을 추가했습니다." />
          </div>
        </div>
      </form>
    </div>
  );
}
