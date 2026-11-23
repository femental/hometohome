import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { listHousesForAdmin } from "@/server/admin/catalog";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { districtLabel, koName, PUBLISH_STATUS } from "../_components/labels";

// Reads the session on every request (see admin/layout.tsx).
export const instant = false;

export default async function HousesPage() {
  await requireAdmin("/admin/houses");
  const houses = await listHousesForAdmin(prisma);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">숙소</h1>
        <Link href="/admin/houses/new" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
          새 숙소 등록
        </Link>
      </div>

      {houses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          등록된 숙소가 없습니다. 먼저 숙소를 등록해 주세요.
        </p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>숙소</Th>
              <Th className="hidden sm:table-cell">지역</Th>
              <Th>상태</Th>
              <Th className="text-right">방</Th>
            </Tr>
          </THead>
          <TBody>
            {houses.map((h) => {
              const status = PUBLISH_STATUS[h.status];
              const published = h.rooms.filter((r) => r.status === "published").length;
              return (
                <Tr key={h.id}>
                  <Td>
                    <Link href={`/admin/houses/${h.id}`} className="font-medium underline-offset-2 hover:underline">
                      {koName(h.name)}
                    </Link>
                  </Td>
                  <Td className="hidden sm:table-cell">{districtLabel(h.district)}</Td>
                  <Td>
                    <Badge className={status.className}>{status.label}</Badge>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {h.rooms.length}개<span className="ml-1 text-xs text-zinc-500">(공개 {published})</span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
