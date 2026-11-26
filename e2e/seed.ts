/**
 * E2E seed (run by global-setup through tsx): a fresh published house + single room, available
 * from today, so every run books its own room. Prints `{"houseId","roomId"}` as the last line.
 */
import { randomUUID } from "node:crypto";

async function main() {
  const { prisma } = await import("@/server/db");
  const { todayKST } = await import("@/domain/dates");
  const { toDbDate } = await import("@/server/bookings/availability");
  try {
    const hostUser = await prisma.user.upsert({
      where: { email: "e2e-host@example.com" },
      update: {},
      create: { id: randomUUID(), email: "e2e-host@example.com", name: "E2E Host", role: "guest" },
    });
    const host =
      (await prisma.host.findFirst({ where: { userId: hostUser.id } })) ??
      (await prisma.host.create({ data: { userId: hostUser.id, displayName: "E2E Host" } }));
    const tag = randomUUID().slice(0, 6);
    const house = await prisma.house.create({
      data: {
        hostId: host.id,
        status: "published",
        name: { en: `E2E House ${tag}`, ko: `E2E 하우스 ${tag}` },
        description: { en: "Created by the E2E run" },
        houseRules: { en: "No parties" },
        addressKo: "서울특별시 마포구 와우산로 94",
        district: "mapo",
        lat: 37.5509,
        lng: 126.9245,
      },
    });
    const room = await prisma.room.create({
      data: {
        houseId: house.id,
        status: "published",
        name: { en: `E2E Room ${tag}`, ko: `E2E 방 ${tag}` },
        description: { en: "Created by the E2E run" },
        monthlyRent: 800_000,
        deposit: 500_000,
        roomType: "single",
        genderPolicy: "any",
        maxOccupants: 1,
        availableFrom: toDbDate(todayKST(new Date())),
      },
    });
    console.log(JSON.stringify({ houseId: house.id, roomId: room.id }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
