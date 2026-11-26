import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { e2eEnv } from "./env";

/** Applies migrations to the local Supabase DB, makes sure the photo bucket exists, seeds a room. */
export default async function globalSetup() {
  const env = { ...process.env, ...e2eEnv(), DIRECT_URL: e2eEnv().DATABASE_URL };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx scripts/setup-storage.ts", { env, stdio: "pipe" });
  const out = execSync("npx tsx e2e/seed.ts", { env, encoding: "utf8" }).trim().split(/\r?\n/);
  writeFileSync("e2e/.seed.json", out[out.length - 1]);
}
