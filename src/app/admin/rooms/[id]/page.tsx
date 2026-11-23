import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { photoUrl } from "@/lib/photo-url";
import { fromDbDate } from "@/server/bookings/availability";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { BlockList } from "../../_components/BlockList";
import { koName } from "../../_components/labels";
import { PhotoManager } from "../../_components/PhotoManager";
import { PublishControls } from "../../_components/PublishControls";
import { RoomForm, type RoomFormValues } from "../../_components/RoomForm";
import { deleteRoomAction, setRoomStatusAction, updateRoomAction } from "../../actions/catalog";

// Reads the session on every request (see admin/layout.tsx).
export const instant = false;

type I18n = { en: string; ko?: string };

export default async function RoomEditPage({ params }: PageProps<"/admin/rooms/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/rooms/${id}`);

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      house: { select: { id: true, name: true } },
      photos: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      blocks: { orderBy: { startDate: "asc" } },
    },
  });
  if (!room) notFound();

  const values: RoomFormValues = {
    name: room.name as I18n,
    description: room.description as I18n,
    monthlyRent: room.monthlyRent,
    deposit: room.deposit,
    availableFrom: fromDbDate(room.availableFrom),
    roomType: room.roomType,
    privateBathroom: room.privateBathroom,
    genderPolicy: room.genderPolicy,
    extraPersonMonthlyFee: room.extraPersonMonthlyFee,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/admin/houses/${room.house.id}`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← {koName(room.house.name)}
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900">{koName(room.name)}</h1>
      </div>

      <Card title="공개 상태">
        <PublishControls
          noun="방"
          status={room.status}
          setStatus={setRoomStatusAction.bind(null, room.id)}
          remove={deleteRoomAction.bind(null, room.id)}
        />
      </Card>

      <Card title="방 정보">
        <RoomForm action={updateRoomAction.bind(null, room.id)} initial={values} submitLabel="변경 사항 저장" />
        <p className="mt-3 text-xs text-zinc-500">가격을 바꿔도 이미 들어온 신청·예약의 금액은 바뀌지 않습니다.</p>
      </Card>

      <Card title="방 사진">
        <PhotoManager
          kind="room"
          ownerId={room.id}
          photos={room.photos.map((p) => ({ id: p.id, url: photoUrl(p.storagePath) }))}
        />
      </Card>

      <Card title="예약 차단 기간">
        <BlockList
          roomId={room.id}
          blocks={room.blocks.map((b) => ({
            id: b.id,
            startDate: fromDbDate(b.startDate),
            endDateExclusive: fromDbDate(b.endDateExclusive),
            reason: b.reason,
          }))}
        />
      </Card>
    </div>
  );
}
