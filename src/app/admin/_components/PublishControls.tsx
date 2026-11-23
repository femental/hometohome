"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ActionResult } from "../actions/messages";
import { ConfirmButton } from "./ConfirmButton";
import { PUBLISH_STATUS, type PublishStatus } from "./labels";

const CHANGE_LABEL: Record<PublishStatus, string> = {
  draft: "작성 중으로 변경",
  published: "공개로 변경",
  hidden: "숨김으로 변경",
};

const DELETE_QUESTION = {
  숙소: "이 숙소를 삭제할까요? 사진과 방도 함께 지워지며 되돌릴 수 없습니다.",
  방: "이 방을 삭제할까요? 사진과 차단 기간도 함께 지워지며 되돌릴 수 없습니다.",
} as const;

/** Status switch (작성 중 / 공개 / 숨김) and a confirmed delete for a house or room. */
export function PublishControls({
  status,
  setStatus,
  remove,
  noun,
}: {
  status: PublishStatus;
  setStatus: (status: PublishStatus) => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
  noun: "숙소" | "방";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: PublishStatus) {
    setError(null);
    startTransition(async () => {
      const r = await setStatus(next);
      if (!r.ok) setError(r.error ?? "상태를 바꾸지 못했습니다.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-700">현재 상태</span>
        <Badge className={PUBLISH_STATUS[status].className}>{PUBLISH_STATUS[status].label}</Badge>
        <span className="mx-1 hidden h-4 w-px bg-zinc-200 sm:inline-block" />
        {(Object.keys(PUBLISH_STATUS) as PublishStatus[])
          .filter((s) => s !== status)
          .map((s) => (
            <Button key={s} variant="secondary" className="px-3 py-1.5" disabled={pending} onClick={() => change(s)}>
              {CHANGE_LABEL[s]}
            </Button>
          ))}
      </div>
      {status === "published" && noun === "방" && (
        <p className="text-xs text-zinc-500">방은 숙소도 공개 상태일 때만 게스트에게 보입니다.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <ConfirmButton
        label={`${noun} 삭제`}
        question={DELETE_QUESTION[noun]}
        onConfirm={remove}
      />
    </div>
  );
}
