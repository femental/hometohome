import { DISTRICTS } from "@/domain/amenities";

export type PublishStatus = "draft" | "published" | "hidden";

export const PUBLISH_STATUS: Record<PublishStatus, { label: string; className: string }> = {
  draft: { label: "작성 중", className: "bg-zinc-100 text-zinc-700" },
  published: { label: "공개", className: "bg-green-100 text-green-800" },
  hidden: { label: "숨김", className: "bg-amber-100 text-amber-800" },
};

export const ROOM_TYPE_LABELS = { single: "1인실", double: "2인실" } as const;
export const GENDER_POLICY_LABELS = { any: "성별 무관", female: "여성 전용", male: "남성 전용" } as const;

export const districtLabel = (code: string) => DISTRICTS.find((d) => d.code === code)?.ko ?? code;

/** Admin screens show the Korean name when there is one. */
export const koName = (v: unknown): string => {
  const o = (v ?? {}) as { en?: string; ko?: string };
  return o.ko || o.en || "(이름 없음)";
};

/** Label for a code, falling back to the code itself (labels are display-only). */
export const labelOf = (labels: Record<string, string>, code: string): string => labels[code] ?? code;

export const PAYMENT_METHOD_LABELS: Record<string, string> = { card: "카드", paypal: "PayPal", offline: "오프라인" };

export const OFFLINE_METHOD_LABELS = { bank_transfer: "계좌이체", cash: "현금", other: "기타" } as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  paid: "결제 완료",
  failed: "실패",
  cancelled: "취소",
  partially_refunded: "부분 환불",
  refunded: "환불 완료",
};

export const REFUND_REASON_LABELS: Record<string, string> = {
  guest_cancel_full: "게스트 취소 (전액)",
  guest_cancel_deposit_only: "게스트 취소 (보증금만)",
  admin_cancel: "운영자 취소",
  late_payment_auto: "기한 후 결제 자동 환불",
  duplicate_payment_auto: "중복 결제 자동 환불",
};

export const REFUND_STATUS_LABELS: Record<string, string> = { pending: "처리 대기", done: "환불 완료", failed: "실패" };

export const REFUND_KIND_LABELS = { full: "전액 환불", deposit_only: "보증금만 환불", not_allowed: "환불 없음" } as const;

export const GENDER_LABELS: Record<string, string> = { male: "남성", female: "여성" };

export const CANCEL_REASON_LABELS: Record<string, string> = { admin_cancel: "운영자 취소", guest_cancel: "게스트 취소" };

export const EMAIL_STATUS_LABELS: Record<string, string> = { sent: "발송", failed: "실패" };
