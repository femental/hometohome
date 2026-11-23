import { useTranslations } from "next-intl";
import type { RoomSearchResult } from "@/server/rooms/search";
import { RoomCard } from "./RoomCard";

export function ResultList({ rooms, stayQuery }: { rooms: RoomSearchResult[]; stayQuery: string }) {
  const t = useTranslations("search");

  if (rooms.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
        <p className="font-medium text-zinc-900">{t("emptyTitle")}</p>
        <p className="mt-1 text-sm text-zinc-600">{t("emptyHint")}</p>
      </div>
    );
  }

  return (
    <ul aria-label={t("resultsHeading")} className="flex flex-col gap-3">
      {rooms.map((room) => (
        <li key={room.roomId}>
          <RoomCard room={room} stayQuery={stayQuery} />
        </li>
      ))}
    </ul>
  );
}
