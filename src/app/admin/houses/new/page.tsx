import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { requireAdmin } from "@/server/auth/session";
import { HouseForm } from "../../_components/HouseForm";
import { createHouseAction } from "../../actions/catalog";

// Reads the session on every request (see admin/layout.tsx).
export const instant = false;

export default async function NewHousePage() {
  await requireAdmin("/admin/houses/new");
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/houses" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← 숙소 목록
      </Link>
      <h1 className="text-xl font-semibold text-zinc-900">새 숙소 등록</h1>
      <p className="text-sm text-zinc-600">처음에는 &lsquo;작성 중&rsquo; 상태로 저장됩니다. 사진과 방은 저장한 뒤 추가할 수 있습니다.</p>
      <Card>
        <HouseForm action={createHouseAction} submitLabel="숙소 저장" />
      </Card>
    </div>
  );
}
