/** Decides whether `npm run db:deploy` may migrate the given database. Pure, so it is unit tested. */
export type DeployCheck = { ok: true; url: string; host: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_PORT = "54329";

export function checkDeployTarget(env: Record<string, string | undefined>, args: string[]): DeployCheck {
  const raw = env.DIRECT_URL || env.DATABASE_URL;
  if (!raw) {
    return { ok: false, reason: "Set DIRECT_URL (or DATABASE_URL) explicitly in the shell; .env files are not read." };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "DIRECT_URL / DATABASE_URL is not a valid URL." };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, reason: "Only postgres:// URLs are supported." };
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const local = LOCAL_HOSTS.has(url.hostname);
  if ((local && url.port === TEST_PORT) || dbName.endsWith("_test")) {
    return { ok: false, reason: `Refusing to migrate the test database (${url.host}/${dbName}); tests manage it themselves.` };
  }
  if (url.port === "6543" || url.searchParams.get("pgbouncer") === "true") {
    return { ok: false, reason: "That is the transaction pooler (port 6543). Migrations need the direct or session connection (port 5432) in DIRECT_URL." };
  }
  if (!local && !args.includes("--yes")) {
    return { ok: false, reason: `${url.host} is a remote database. Re-run with --yes to apply migrations to it.` };
  }
  return { ok: true, url: raw, host: url.host };
}
