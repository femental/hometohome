import Form from "next/form";
import Link from "next/link";
import { z } from "zod";
import { statusBadge, StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import type { BookingStatus } from "@/domain/booking-status";
import { isValidISODate } from "@/domain/dates";
import { formatKRW } from "@/lib/format";
import { listBookings } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { koName } from "../_components/labels";

// Reads the session and search params on every request (see admin/layout.tsx).
export const instant = false;

const STATUS_KEYS: Record<BookingStatus, true> = {
  requested: true,
  awaiting_payment: true,
  confirmed: true,
  completed: true,
  cancelled: true,
  rejected: true,
  request_expired: true,
  payment_expired: true,
  withdrawn: true,
};
const STATUSES = Object.keys(STATUS_KEYS) as BookingStatus[];

const isoDate = z.string().refine(isValidISODate);

type SearchParams = Record<string, string | string[] | undefined>;

const all = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const first = (v: string | string[] | undefined): string | undefined => all(v)[0] || undefined;

/** GET filters; anything malformed is ignored rather than rejected. */
function parseFilters(sp: SearchParams) {
  const status = all(sp.status).filter((s): s is BookingStatus => s in STATUS_KEYS);
  const roomId = z.uuid().safeParse(first(sp.room));
  const from = isoDate.safeParse(first(sp.from));
  const to = isoDate.safeParse(first(sp.to));
  return {
    status: status.length > 0 ? status : undefined,
    roomId: roomId.success ? roomId.data : undefined,
    from: from.success ? from.data : undefined,
    to: to.success ? to.data : undefined,
  };
}

export default async function BookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAdmin("/admin/bookings");
  const filters = parseFilters(await searchParams);
  const now = new Date();
  const [bookings, rooms] = await Promise.all([
    listBookings(prisma, filters, now),
    prisma.room.findMany({ select: { id: true, name: true, house: { select: { name: true } } } }),
  ]);
  const roomOptions = rooms
    .map((r) => ({ id: r.id, label: `${koName(r.house.name)} · ${koName(r.name)}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const filtered = Boolean(filters.status || filters.roomId || filters.from || filters.to);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">예약</h1>

      <Form action="/admin/bookings" className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-zinc-700">상태</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-zinc-700">
                <input type="checkbox" name="status" value={s} defaultChecked={filters.status?.includes(s)} />
                {statusBadge(s).label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            방
            <select
              name="room"
              defaultValue={filters.roomId ?? ""}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-900"
            >
              <option value="">전체</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            입주일 (부터)
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ""}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            입주일 (까지)
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ""}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-900"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            검색
          </button>
          {filtered && (
            <Link href="/admin/bookings" className="text-sm text-zinc-600 underline">
              필터 초기화
            </Link>
          )}
        </div>
      </Form>

      <p className="text-sm text-zinc-500">{bookings.length.toLocaleString("ko-KR")}건 · 최근 신청 순</p>

      {bookings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          {filtered ? "조건에 맞는 예약이 없습니다." : "아직 예약이 없습니다."}
        </p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>상태</Th>
              <Th>신청자</Th>
              <Th className="hidden sm:table-cell">숙소 · 방</Th>
              <Th>기간</Th>
              <Th className="hidden text-right md:table-cell">첫 결제</Th>
            </Tr>
          </THead>
          <TBody>
            {bookings.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                <Td>
                  <Link href={`/admin/bookings/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                    {b.guestName}
                  </Link>
                  <p className="text-xs text-zinc-500">{b.guestEmail}</p>
                </Td>
                <Td className="hidden sm:table-cell">
                  {b.houseName} · {b.roomName}
                </Td>
                <Td className="whitespace-nowrap">
                  {b.moveIn} ~ {b.lastNight}
                </Td>
                <Td className="hidden text-right whitespace-nowrap md:table-cell">{formatKRW(b.firstPaymentTotal)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
