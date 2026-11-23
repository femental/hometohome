import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CONTROL =
  "w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400";

type Common = { label: string; name: string; error?: string; hint?: string };

type InputProps = Common & { as?: "input" } & Omit<InputHTMLAttributes<HTMLInputElement>, "name">;
type SelectProps = Common & { as: "select" } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name">;
type TextareaProps = Common & { as: "textarea" } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name">;

export function Field(props: InputProps | SelectProps | TextareaProps) {
  const { label, name, error, hint, as = "input", id, ...rest } = props;
  const fieldId = id ?? name;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const cls = `${CONTROL} ${error ? "border-red-500" : "border-zinc-300"}`;
  const shared = { id: fieldId, name, className: cls, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-zinc-700">
        {label}
      </label>
      {as === "select" ? (
        <select {...shared} {...(rest as SelectHTMLAttributes<HTMLSelectElement>)} />
      ) : as === "textarea" ? (
        <textarea rows={4} {...shared} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input {...shared} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="text-xs text-zinc-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
