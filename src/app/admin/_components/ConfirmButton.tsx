"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import type { ActionResult } from "../actions/messages";

/**
 * Two-step button: the first click asks, the second runs `onConfirm`. Destructive by default;
 * `tone="neutral"` is for consequential but non-destructive steps (approve, mark completed).
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "삭제",
  onConfirm,
  size = "md",
  tone = "danger",
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<ActionResult>;
  size?: "sm" | "md";
  tone?: "danger" | "neutral";
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "";

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await onConfirm();
      if (!r.ok) setError(r.error ?? "처리하지 못했습니다.");
      setAsking(false);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {asking ? (
        <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-700">{question}</span>
          <Button variant={tone === "danger" ? "danger" : "primary"} className={pad} pending={pending} onClick={confirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" className={pad} disabled={pending} onClick={() => setAsking(false)}>
            취소
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          className={`self-start ${tone === "danger" ? "text-red-700" : ""} ${pad}`}
          onClick={() => setAsking(true)}
        >
          {label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
