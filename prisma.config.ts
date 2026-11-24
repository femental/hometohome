import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Prisma 7 does not load .env itself; callers (scripts, test setup) provide the URL.
    // Migrations need a direct connection: in production DATABASE_URL is the transaction pooler
    // (port 6543), so DIRECT_URL (port 5432) is preferred when set.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://h2h:h2h@localhost:54329/h2h",
  },
});
