import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & { title?: ReactNode };

export function Card({ title, className = "", children, ...rest }: Props) {
  return (
    <div {...rest} className={`rounded-lg border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-zinc-900">{title}</h2>}
      {children}
    </div>
  );
}
