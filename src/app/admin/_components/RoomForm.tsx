"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormMessage, I18nField, useActionForm, useFieldIds, type FormAction } from "./form-utils";
import { GENDER_POLICY_LABELS, ROOM_TYPE_LABELS } from "./labels";

type I18n = { en: string; ko?: string };

export type RoomFormValues = {
  name: I18n;
  description: I18n;
  monthlyRent: number;
  deposit: number;
  availableFrom: string;
  roomType: "single" | "double";
  privateBathroom: boolean;
  genderPolicy: "male" | "female" | "any";
  extraPersonMonthlyFee: number;
};

export function RoomForm({
  action,
  initial,
  submitLabel,
}: {
  action: FormAction;
  initial?: RoomFormValues;
  submitLabel: string;
}) {
  const { state, pending, onSubmit, fieldError } = useActionForm(action);
  const fieldId = useFieldIds();
  const [roomType, setRoomType] = useState<string>(initial?.roomType ?? "single");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <I18nField label="방 이름" name="name" value={initial?.name} error={fieldError} fieldId={fieldId} />
      <I18nField label="설명" name="description" value={initial?.description} error={fieldError} fieldId={fieldId} multiline />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="월세 (원)"
          id={fieldId("monthlyRent")}
          name="monthlyRent"
          inputMode="numeric"
          defaultValue={initial?.monthlyRent?.toString() ?? ""}
          error={fieldError("monthlyRent")}
        />
        <Field
          label="보증금 (원)"
          id={fieldId("deposit")}
          name="deposit"
          inputMode="numeric"
          defaultValue={initial?.deposit?.toString() ?? ""}
          error={fieldError("deposit")}
        />
        <Field
          label="입주 가능일"
          id={fieldId("availableFrom")}
          name="availableFrom"
          type="date"
          defaultValue={initial?.availableFrom ?? ""}
          error={fieldError("availableFrom")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          as="select"
          label="방 유형"
          id={fieldId("roomType")}
          name="roomType"
          value={roomType}
          onChange={(e) => setRoomType(e.target.value)}
          error={fieldError("roomType")}
        >
          {Object.entries(ROOM_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Field>
        <Field
          as="select"
          label="성별 정책"
          id={fieldId("genderPolicy")}
          name="genderPolicy"
          defaultValue={initial?.genderPolicy ?? "any"}
          error={fieldError("genderPolicy")}
        >
          {Object.entries(GENDER_POLICY_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Field>
        {roomType === "double" && (
          <Field
            label="2인 입주 시 추가 월 요금 (원)"
            id={fieldId("extraPersonMonthlyFee")}
            name="extraPersonMonthlyFee"
            inputMode="numeric"
            defaultValue={initial?.extraPersonMonthlyFee?.toString() ?? "0"}
            error={fieldError("extraPersonMonthlyFee")}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="privateBathroom" defaultChecked={initial?.privateBathroom} />
        개인 욕실
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        <div className="flex-1">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}
