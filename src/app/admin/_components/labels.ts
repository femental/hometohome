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
