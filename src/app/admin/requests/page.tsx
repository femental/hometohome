import Link from "next/link";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { formatKRW, formatKST, formatRemainingKo } from "@/lib/format";
import { listRequests } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";

// Reads the session and the request queue on every request (see admin/layout.tsx).
export const instant = false;

const URGENT_MS = 12 * 3_600_000;

export default async function RequestsPage() {
  await requireAdmin("/admin/requests");
  const now = new Date();
  const requests = await listRequests(prisma, now);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-zinc-900">응답 대기 신청</h1>
        <p className="text-sm text-zinc-500">응답 기한이 지나면 신청은 자동으로 만료됩니다. 기한이 가까운 순서입니다.</p>
      </div>

      {requests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          응답을 기다리는 신청이 없습니다.
        </p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>신청자</Th>
              <Th>숙소 · 방</Th>
              <Th className="hidden sm:table-cell">기간</Th>
              <Th className="hidden text-right md:table-cell">첫 결제</Th>
              <Th className="text-right">남은 응답 시간</Th>
            </Tr>
          </THead>
          <TBody>
            {requests.map((r) => {
              const urgent = r.requestExpiresAt && r.requestExpiresAt.getTime() - now.getTime() < URGENT_MS;
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/bookings/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.guestName}
                    </Link>
                    <p className="text-xs text-zinc-500">{r.guestEmail}</p>
                  </Td>
                  <Td>
                    {r.houseName} · {r.roomName}
                  </Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">
                    {r.moveIn} ~ {r.lastNight}
                  </Td>
                  <Td className="hidden text-right whitespace-nowrap md:table-cell">{formatKRW(r.firstPaymentTotal)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.requestExpiresAt ? (
                      <>
                        <span className={urgent ? "font-medium text-red-700" : ""}>
                          {formatRemainingKo(r.requestExpiresAt, now)}
                        </span>
                        <p className="text-xs text-zinc-500">{formatKST(r.requestExpiresAt)}</p>
                      </>
                    ) : (
                      "—"
                    )}
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
