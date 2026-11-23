import type { ReactNode } from "react";
import type { BookingStatus } from "@/domain/booking-status";

const BASE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

const STATUS: Record<BookingStatus, { label: string; className: string }> = {
  requested: { label: "신청됨", className: "bg-blue-100 text-blue-800" },
  rejected: { label: "거절됨", className: "bg-red-100 text-red-800" },
  request_expired: { label: "신청 만료", className: "bg-zinc-100 text-zinc-600" },
  withdrawn: { label: "철회됨", className: "bg-zinc-100 text-zinc-600" },
  awaiting_payment: { label: "결제 대기", className: "bg-amber-100 text-amber-800" },
  payment_expired: { label: "결제 만료", className: "bg-zinc-100 text-zinc-600" },
  confirmed: { label: "확정", className: "bg-green-100 text-green-800" },
  cancelled: { label: "취소됨", className: "bg-red-100 text-red-800" },
  completed: { label: "퇴실 완료", className: "bg-emerald-100 text-emerald-800" },
};

export function statusBadge(status: BookingStatus): { label: string; className: string } {
  return STATUS[status];
}

export function Badge({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`${BASE} ${className}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { label, className } = statusBadge(status);
  return <Badge className={className}>{label}</Badge>;
}
