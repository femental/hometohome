import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ className = "", ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table {...rest} className={`w-full border-collapse text-left text-sm ${className}`} />
    </div>
  );
}

export function THead({ className = "", ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...rest} className={`bg-zinc-50 text-zinc-600 ${className}`} />;
}

export function TBody({ className = "", ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...rest} className={`divide-y divide-zinc-200 bg-white ${className}`} />;
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export function Th({ className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" {...rest} className={`px-4 py-2 font-medium ${className}`} />;
}

export function Td({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...rest} className={`px-4 py-2 text-zinc-900 ${className}`} />;
}
