/**
 * Local-only: creates one guest booking request through the real phase-1 `createRequest`,
 * so the admin request screens have something to work on.
 *
 *   npx tsx scripts/seed-request.ts
 *
 * Reuses (or creates) a seed guest and the newest published room open by the move-in date;
 * creates a seed house + room when there is none. Move-in is today (KST) + 14 days, for 2 months.
 * Reads DATABASE_URL from the environment or `.env.local`, and refuses any non-local database.
 */
import { randomUUID } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const GUEST_EMAIL = "seed-guest@example.com";
const HOST_EMAIL = "seed-host@example.com";

function databaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local: fall through to the check below.
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (environment or .env.local).");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed a non-local database (host "${host}"). Only localhost / 127.0.0.1 are allowed.`);
  }
  return url;
}

async function main() {
  databaseUrl();
  // Imported after the env check: the DB client connects with DATABASE_URL at import time.
  const { prisma } = await import("@/server/db");
  const { createRequest } = await import("@/server/bookings/service");
  const { addDays, addMonthsClamped, todayKST } = await import("@/domain/dates");
  const { toDbDate } = await import("@/server/bookings/availability");

  try {
    const now = new Date();
    const moveIn = addDays(todayKST(now), 14);
    const lastNight = addDays(addMonthsClamped(moveIn, 2), -1);

    const guest = await prisma.user.upsert({
      where: { email: GUEST_EMAIL },
      update: {},
      create: { id: randomUUID(), email: GUEST_EMAIL, name: "Seed Guest", role: "guest", locale: "en" },
    });

    let room = await prisma.room.findFirst({
      where: {
        status: "published",
        house: { status: "published" },
        availableFrom: { lte: toDbDate(moveIn) },
      },
      orderBy: [{ house: { createdAt: "desc" } }, { id: "asc" }],
    });

    if (!room) {
      const hostUser = await prisma.user.upsert({
        where: { email: HOST_EMAIL },
        update: {},
        create: { id: randomUUID(), email: HOST_EMAIL, name: "Seed Host", role: "guest" },
      });
      const host =
        (await prisma.host.findFirst({ where: { userId: hostUser.id } })) ??
        (await prisma.host.create({ data: { userId: hostUser.id, displayName: "Seed Host" } }));
      const house = await prisma.house.create({
        data: {
          hostId: host.id,
          status: "published",
          name: { en: "Seed House", ko: "시드 하우스" },
          description: { en: "A house created by scripts/seed-request.ts" },
          houseRules: { en: "No parties" },
          addressKo: "서울특별시 마포구 와우산로 94",
          district: "mapo",
          lat: 37.5509,
          lng: 126.9245,
        },
      });
      room = await prisma.room.create({
        data: {
          houseId: house.id,
          status: "published",
          name: { en: "Seed Room", ko: "시드 방" },
          description: { en: "A room created by scripts/seed-request.ts" },
          monthlyRent: 800_000,
          deposit: 500_000,
          roomType: "single",
          genderPolicy: "any",
          maxOccupants: 1,
          availableFrom: toDbDate(todayKST(now)),
        },
      });
      console.log(`Created seed house ${house.id} and room ${room.id}.`);
    }

    const booking = await createRequest(
      prisma,
      {
        roomId: room.id,
        guestId: guest.id,
        moveIn,
        lastNight,
        occupants: 1,
        guestName: "Seed Guest",
        nationality: "US",
        gender: room.genderPolicy === "female" ? "female" : "male",
        contact: "WhatsApp +1 555 0100",
        message: "Hi! Seeded request for local testing.",
      },
      now,
    );

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    console.log(`Created request ${booking.id} (room ${room.id}, ${moveIn} ~ ${lastNight}).`);
    console.log(`${appUrl}/admin/bookings/${booking.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
