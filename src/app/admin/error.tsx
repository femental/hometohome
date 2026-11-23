"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-white p-5">
      <h2 className="text-base font-semibold text-zinc-900">문제가 발생했습니다</h2>
      <p className="text-sm text-zinc-600">잠시 후 다시 시도해 주세요. 계속되면 입력 내용을 확인하거나 페이지를 새로고침해 주세요.</p>
      <Button variant="secondary" onClick={() => retry()}>
        다시 시도
      </Button>
    </div>
  );
}
