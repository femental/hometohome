import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { todayKST } from "@/domain/dates";
import { formatKRW, formatKST, formatRemainingKo } from "@/lib/format";
import { getBookingDetail } from "@/server/admin/bookings";
import { previewCancellation } from "@/server/bookings/refunds";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { BookingActions } from "../../_components/BookingActions";
import type { CancelPreviewData } from "../../_components/CancelPreview";
import { CANCEL_REASON_LABELS, EMAIL_STATUS_LABELS, GENDER_LABELS, labelOf } from "../../_components/labels";
import { RefundList } from "../../_components/RefundList";
import { knownErrorMessage } from "../../actions/messages";

// Reads the session and live booking state on every request (see admin/layout.tsx).
export const instant = false;

const CANCELLABLE = new Set(["awaiting_payment", "confirmed"]);

/** What an operator cancel would refund right now, or the Korean reason it is not possible. */
async function loadCancelPreview(bookingId: string, now: Date): Promise<CancelPreviewData> {
  try {
    const p = await previewCancellation(prisma, bookingId, { kind: "admin" }, now);
    return { ok: true, kind: p.kind, amountKrw: p.amountKrw, payments: p.payments };
  } catch (e) {
    const error = knownErrorMessage(e);
    if (error === null) throw e;
    return { ok: false, error };
  }
}

/** A label/value line; falsy entries are skipped so optional lines can be written inline. */
type Row = [string, ReactNode] | false | null | undefined;

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.filter((r): r is [string, ReactNode] => !!r).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="break-words text-zinc-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const at = (d: Date | null) => (d ? formatKST(d) : "—");

export default async function BookingDetailPage({ params }: PageProps<"/admin/bookings/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/bookings/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();

  const now = new Date();
  const b = await getBookingDetail(prisma, id, now);
  if (!b) notFound();
  const cancelPreview = CANCELLABLE.has(b.status) ? await loadCancelPreview(b.id, now) : null;

  const applicant: Row[] = [
    ["이름", b.guestName],
    ["이메일", b.guest.email],
    ["메일 언어", b.guest.locale === "ko" ? "한국어" : "영어"],
    ["국적", b.nationality],
    ["성별", labelOf(GENDER_LABELS, b.gender)],
    ["연락처", b.contact || "—"],
    ["인원", `${b.occupants}명`],
    b.occupants === 2 && [
      "동반 입주자",
      `${b.coOccupantName ?? "—"} (${labelOf(GENDER_LABELS, b.coOccupantGender ?? "")})`,
    ],
    ["메시지", b.message ? <span className="whitespace-pre-line">{b.message}</span> : "—"],
  ];

  const price: Row[] = [
    ["기간", `${b.moveIn} ~ ${b.lastNight} (퇴실 ${b.moveOut})`],
    ["개월 · 남는 일수", `${b.fullMonths}개월${b.extraDays > 0 ? ` + ${b.extraDays}일` : ""}`],
    ["적용 월세", formatKRW(b.monthlyRent)],
    ["보증금", formatKRW(b.deposit)],
    b.extraDays > 0 && ["일할 금액", formatKRW(b.proratedAmount)],
    ["총 숙박 금액", formatKRW(b.stayTotal)],
    ["첫 월세", formatKRW(b.firstRentAmount)],
    ["첫 결제 금액", <strong key="total">{formatKRW(b.firstPaymentTotal)}</strong>],
  ];

  const timeline: Row[] = [
    ["신청", at(b.requestedAt)],
    b.status === "requested" &&
      b.requestExpiresAt && ["응답 기한", `${formatKST(b.requestExpiresAt)} · ${formatRemainingKo(b.requestExpiresAt, now)}`],
    ["승인", at(b.approvedAt)],
    b.status === "awaiting_payment" &&
      b.holdExpiresAt && ["결제 기한", `${formatKST(b.holdExpiresAt)} · ${formatRemainingKo(b.holdExpiresAt, now)}`],
    ["확정", at(b.confirmedAt)],
    !!b.rejectedReason && ["거절 사유", b.rejectedReason],
    !!b.cancelledAt && ["취소", `${formatKST(b.cancelledAt)} (${labelOf(CANCEL_REASON_LABELS, b.cancelReason ?? "—")})`],
    !!b.depositReturnedAt && [
      "보증금 반환",
      `${formatKST(b.depositReturnedAt)}${b.depositReturnNote ? ` · ${b.depositReturnNote}` : ""}`,
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/bookings" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← 예약 목록
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-900">{b.guestName}</h1>
          <StatusBadge status={b.status} />
        </div>
        <p className="text-sm text-zinc-500">
          <Link href={`/admin/rooms/${b.room.id}`} className="underline-offset-2 hover:underline">
            {b.house.name} · {b.room.name}
          </Link>
          {" · "}
          {b.moveIn} ~ {b.lastNight}
        </p>
      </div>

      <Card title="처리">
        <BookingActions
          bookingId={b.id}
          status={b.status}
          moveIn={b.moveIn}
          canComplete={todayKST(now) >= b.moveIn}
          depositReturned={b.depositReturnedAt !== null}
          firstPaymentTotal={b.firstPaymentTotal}
          cancelPreview={cancelPreview}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="신청자 정보">
          <Rows rows={applicant} />
        </Card>
        <Card title="가격 (신청 시점 고정)">
          <Rows rows={price} />
        </Card>
      </div>

      <Card title="진행 이력">
        <Rows rows={timeline} />
      </Card>

      <Card title="결제 · 환불 내역">
        <RefundList payments={b.payments} />
      </Card>

      <Card title="메일 발송 이력">
        {b.emailLogs.length === 0 ? (
          <p className="text-sm text-zinc-500">발송한 메일이 없습니다.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>시각</Th>
                <Th>받는 사람</Th>
                <Th className="hidden sm:table-cell">제목</Th>
                <Th>결과</Th>
              </Tr>
            </THead>
            <TBody>
              {b.emailLogs.map((l) => (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{formatKST(l.createdAt)}</Td>
                  <Td className="text-xs">{l.toEmail}</Td>
                  <Td className="hidden text-xs sm:table-cell">{l.subject ?? l.template}</Td>
                  <Td className="text-xs">
                    <span className={l.status === "failed" ? "text-red-700" : ""}>
                      {labelOf(EMAIL_STATUS_LABELS, l.status)}
                    </span>
                    {l.error && <p className="text-zinc-500">{l.error}</p>}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
