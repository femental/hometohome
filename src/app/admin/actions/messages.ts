import "server-only";
import { CatalogError, type CatalogErrorCode } from "@/server/admin/catalog";
import { BookingError, type BookingErrorCode } from "@/server/bookings/errors";
import { PhotoError, type PhotoErrorCode } from "@/server/photos/service";

/** What admin Server Actions return to their forms (`useActionState`) and buttons. */
export type ActionResult = { ok: true } | { ok: false; error?: string; fieldErrors?: Record<string, string> };

export const CATALOG_ERROR_MESSAGES: Record<CatalogErrorCode, string> = {
  NOT_FOUND: "대상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
  HAS_BOOKINGS: "예약 이력이 있어 삭제할 수 없습니다. 숨김으로 바꿔주세요.",
  BLOCK_CONFLICT: "이 기간에 진행 중인 예약이 있어 차단할 수 없습니다.",
  INVALID: "입력값이 올바르지 않습니다.",
};

export const PHOTO_ERROR_MESSAGES: Record<PhotoErrorCode, string> = {
  BAD_TYPE: "JPG, PNG, WEBP 이미지만 올릴 수 있습니다.",
  TOO_LARGE: "사진은 한 장에 4MB 이하만 올릴 수 있습니다.",
  NOT_FOUND: "사진 또는 대상 숙소·방을 찾을 수 없습니다.",
  LIMIT: "사진은 최대 20장까지 올릴 수 있습니다.",
};

export const BOOKING_ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다",
  ROOM_NOT_PUBLISHED: "공개되지 않은 방입니다",
  TOO_SOON: "입주일은 오늘부터 3일 이후여야 합니다",
  BEFORE_AVAILABLE: "방의 입주 가능일보다 이른 입주일입니다",
  GENDER_MISMATCH: "방의 성별 정책과 입주자 성별이 맞지 않습니다",
  TOO_MANY_OCCUPANTS: "방의 최대 인원을 넘었습니다",
  ROOM_UNAVAILABLE: "같은 기간에 이미 점유된 예약이 있습니다",
  PRICING: "기간 또는 금액을 계산할 수 없습니다",
  INVALID_STATE: "현재 상태에서는 할 수 없는 작업입니다",
  FORBIDDEN: "이 예약에 대한 권한이 없습니다",
  CANCEL_NOT_ALLOWED: "입주일 이후에는 온라인 취소가 불가합니다",
  NOT_FOUND: "예약을 찾을 수 없습니다",
  AMOUNT_MISMATCH: "받은 금액이 첫 결제 금액과 다릅니다",
  REFUND_CHANGED: "환불 금액이 바뀌었습니다. 새 금액을 확인한 뒤 다시 취소해 주세요.",
};

export const BOOKING_NOT_FOUND = BOOKING_ERROR_MESSAGES.NOT_FOUND;

function bookingErrorMessage(e: BookingError): string {
  return BOOKING_ERROR_MESSAGES[e.code];
}

export const INVALID_FORM = "입력값을 확인해 주세요.";

/** Korean message for a known domain error; null for anything else (callers rethrow it). */
export function knownErrorMessage(e: unknown): string | null {
  if (e instanceof CatalogError) {
    // INVALID may carry a specific Korean message from the service.
    return e.code === "INVALID" && e.message !== e.code ? e.message : CATALOG_ERROR_MESSAGES[e.code];
  }
  if (e instanceof PhotoError) return PHOTO_ERROR_MESSAGES[e.code];
  if (e instanceof BookingError) return bookingErrorMessage(e);
  return null;
}

/** Runs `op`; known domain errors become `{ ok: false, error }`, anything else is rethrown. */
export async function attempt<T>(op: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await op() };
  } catch (e) {
    const error = knownErrorMessage(e);
    if (error === null) throw e;
    return { ok: false, error };
  }
}
