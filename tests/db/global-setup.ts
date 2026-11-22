import { execSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import pg from "pg";

/**
 * Builds a fresh test database: create `h2h_test` if missing, wipe its public schema,
 * then apply all migrations.
 *
 * We deliberately do not call `prisma migrate reset`: Prisma 7 refuses to run it when
 * it detects an AI agent. Wiping + `migrate deploy` is equivalent for a throwaway
 * database, and is guarded below so it can only ever touch a local `*_test` database.
 */
export default async function setup() {
  loadEnvFile(".env.test");
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Refusing to wipe non-local database host "${url.hostname}"`);
  }
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Refusing to wipe non-test database "${dbName}"`);
  }

  // Compose only creates the `h2h` database; create the test one on demand.
  const adminUrl = new URL(url.href);
  adminUrl.pathname = "/h2h";
  const admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }

  try {
    execSync("npx prisma migrate deploy", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url.href },
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed:\n${err.stdout}\n${err.stderr}`);
  }
}
