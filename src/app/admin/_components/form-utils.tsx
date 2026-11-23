"use client";

import { startTransition, useActionState, useId, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import type { ActionResult } from "../actions/messages";

export type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * useActionState driven from onSubmit instead of `<form action>`: React resets a form after an
 * action-prop submission, which would wipe the operator's input when the server returns errors.
 */
export function useActionForm(action: FormAction) {
  const [state, dispatch, pending] = useActionState(action, null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }
  const fieldError = (key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);
  return { state, pending, onSubmit, fieldError };
}

export function FormMessage({ state, success = "저장했습니다." }: { state: ActionResult | null; success?: string }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
        {success}
      </p>
    );
  }
  if (!state.error) return null;
  return (
    <p role="alert" className="whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {state.error}
    </p>
  );
}

/** Unique element ids per form instance (two forms on one page share field names). */
export function useFieldIds() {
  const uid = useId();
  return (name: string) => `${uid}-${name}`;
}

type I18nValue = { en: string; ko?: string };

/** `<name>.en` (required) and `<name>.ko` side by side; the schema's FormData convention. */
export function I18nField({
  label,
  name,
  value,
  error,
  fieldId,
  multiline = false,
}: {
  label: string;
  name: string;
  value?: I18nValue;
  error: (key: string) => string | undefined;
  fieldId: (name: string) => string;
  multiline?: boolean;
}) {
  const common = multiline ? ({ as: "textarea", rows: 4 } as const) : ({ as: "input" } as const);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field {...common} label={`${label} (영문, 필수)`} id={fieldId(`${name}.en`)} name={`${name}.en`} defaultValue={value?.en ?? ""} error={error(`${name}.en`)} />
      <Field {...common} label={`${label} (한글)`} id={fieldId(`${name}.ko`)} name={`${name}.ko`} defaultValue={value?.ko ?? ""} error={error(`${name}.ko`)} />
    </div>
  );
}
