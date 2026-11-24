import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { formatKST } from "@/lib/format";
import { dashboardCounts, listRequests } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";

// Reads the session and live counts on every request (see admin/layout.tsx).
export const instant = false;

const SHORTCUT_LIMIT = 5;

export default async function AdminDashboard() {
  await requireAdmin("/admin");
  const now = new Date();
  const [counts, requests] = await Promise.all([dashboardCounts(prisma, now), listRequests(prisma, now)]);

  const cards = [
    { label: "응답 대기 신청", value: counts.pendingRequests, href: "/admin/requests" },
    { label: "결제 대기", value: counts.awaitingPayment, href: "/admin/bookings" },
    { label: "이번 달 입주 예정", value: counts.moveInsThisMonth, href: "/admin/bookings" },
    { label: "이번 달 퇴실 예정", value: counts.moveOutsThisMonth, href: "/admin/bookings" },
    { label: "수동 환불 처리 대기", value: counts.manualRefundsPending, href: "/admin/bookings" },
    { label: "PG 환불 실패", value: counts.failedRefunds, href: "/admin/bookings" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900">대시보드</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-zinc-400"
          >
            <p className="text-xs text-zinc-500">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{c.value.toLocaleString("ko-KR")}</p>
          </Link>
        ))}
      </div>

      <Card title="응답 대기 신청">
        {requests.length === 0 ? (
          <p className="text-sm text-zinc-500">응답을 기다리는 신청이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {requests.slice(0, SHORTCUT_LIMIT).map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/bookings/${r.id}`}
                  className="flex flex-col gap-0.5 py-2.5 hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm text-zinc-900">
                    {r.guestName} · {r.houseName} {r.roomName}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {r.moveIn} ~ {r.lastNight}
                    {r.requestExpiresAt && ` · 응답 기한 ${formatKST(r.requestExpiresAt)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/requests" className="mt-3 inline-block text-sm font-medium text-zinc-900 underline">
          신청 전체 보기{requests.length > SHORTCUT_LIMIT && ` (${requests.length}건)`}
        </Link>
      </Card>
    </div>
  );
}
