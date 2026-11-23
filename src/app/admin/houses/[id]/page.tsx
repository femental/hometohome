import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { formatKRW } from "@/lib/format";
import { photoUrl } from "@/lib/photo-url";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { HouseForm, type HouseFormValues } from "../../_components/HouseForm";
import { koName, PUBLISH_STATUS, ROOM_TYPE_LABELS } from "../../_components/labels";
import { PhotoManager } from "../../_components/PhotoManager";
import { PublishControls } from "../../_components/PublishControls";
import { RoomForm } from "../../_components/RoomForm";
import {
  createRoomAction,
  deleteHouseAction,
  setHouseStatusAction,
  updateHouseAction,
} from "../../actions/catalog";

// Reads the session on every request (see admin/layout.tsx).
export const instant = false;

type I18n = { en: string; ko?: string };

export default async function HouseEditPage({ params }: PageProps<"/admin/houses/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/houses/${id}`);

  const house = await prisma.house.findUnique({
    where: { id },
    include: {
      photos: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      rooms: { orderBy: { id: "asc" } },
    },
  });
  if (!house) notFound();

  const values: HouseFormValues = {
    name: house.name as I18n,
    description: house.description as I18n,
    houseRules: house.houseRules as I18n,
    addressKo: house.addressKo,
    addressEn: house.addressEn ?? "",
    district: house.district,
    lat: house.lat,
    lng: house.lng,
    nearestStations: house.nearestStations as HouseFormValues["nearestStations"],
    amenities: house.amenities,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/houses" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← 숙소 목록
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900">{koName(house.name)}</h1>
      </div>

      <Card title="공개 상태">
        <PublishControls
          noun="숙소"
          status={house.status}
          setStatus={setHouseStatusAction.bind(null, house.id)}
          remove={deleteHouseAction.bind(null, house.id)}
        />
      </Card>

      <Card title="숙소 정보">
        <HouseForm action={updateHouseAction.bind(null, house.id)} initial={values} submitLabel="변경 사항 저장" />
      </Card>

      <Card title="숙소 사진">
        <PhotoManager
          kind="house"
          ownerId={house.id}
          photos={house.photos.map((p) => ({ id: p.id, url: photoUrl(p.storagePath) }))}
        />
      </Card>

      <Card title={`방 (${house.rooms.length})`}>
        {house.rooms.length === 0 ? (
          <p className="text-sm text-zinc-500">등록된 방이 없습니다.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>방</Th>
                <Th className="hidden sm:table-cell">유형</Th>
                <Th className="text-right">월세</Th>
                <Th>상태</Th>
              </Tr>
            </THead>
            <TBody>
              {house.rooms.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/rooms/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {koName(r.name)}
                    </Link>
                  </Td>
                  <Td className="hidden sm:table-cell">{ROOM_TYPE_LABELS[r.roomType]}</Td>
                  <Td className="text-right whitespace-nowrap">{formatKRW(r.monthlyRent)}</Td>
                  <Td>
                    <Badge className={PUBLISH_STATUS[r.status].className}>{PUBLISH_STATUS[r.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        <details className="mt-4 rounded-md border border-zinc-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900">새 방 추가</summary>
          <div className="mt-4">
            <RoomForm action={createRoomAction.bind(null, house.id)} submitLabel="방 저장" />
          </div>
        </details>
      </Card>
    </div>
  );
}
