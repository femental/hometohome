import "server-only";
import { CatalogError, type CatalogErrorCode } from "@/server/admin/catalog";
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
  TOO_LARGE: "사진은 한 장에 10MB 이하만 올릴 수 있습니다.",
  NOT_FOUND: "사진 또는 대상 숙소·방을 찾을 수 없습니다.",
  LIMIT: "사진은 최대 20장까지 올릴 수 있습니다.",
};

export const INVALID_FORM = "입력값을 확인해 주세요.";

/** Korean message for a known domain error; null for anything else (callers rethrow it). */
export function knownErrorMessage(e: unknown): string | null {
  if (e instanceof CatalogError) {
    // INVALID may carry a specific Korean message from the service.
    return e.code === "INVALID" && e.message !== e.code ? e.message : CATALOG_ERROR_MESSAGES[e.code];
  }
  if (e instanceof PhotoError) return PHOTO_ERROR_MESSAGES[e.code];
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
