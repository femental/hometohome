/**
 * Applies pending migrations to a real database (production / staging):
 *
 *   DIRECT_URL="postgresql://…:5432/postgres" npm run db:deploy -- --yes
 *
 * Uses the direct connection (not the transaction pooler). The URL must come from the shell —
 * .env files are not read — and remote hosts need --yes. The test database is always refused.
 */
import { spawnSync } from "node:child_process";
import { checkDeployTarget } from "./db-deploy-target";

const check = checkDeployTarget(process.env, process.argv.slice(2));
if (!check.ok) {
  console.error(`db:deploy refused: ${check.reason}`);
  process.exit(1);
}

console.log(`Applying migrations to ${check.host} …`);
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DIRECT_URL: check.url, DATABASE_URL: check.url },
});
process.exit(result.status ?? 1);
