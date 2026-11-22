import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Prisma 7 does not load .env itself; callers (scripts, test setup) provide DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgresql://h2h:h2h@localhost:54329/h2h",
  },
});
