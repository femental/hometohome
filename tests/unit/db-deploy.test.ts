import { expect, test } from "vitest";
import { checkDeployTarget } from "../../scripts/db-deploy-target";

const PROD = "postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";

test("refuses when no URL is given explicitly", () => {
  expect(checkDeployTarget({}, ["--yes"])).toMatchObject({ ok: false, reason: expect.stringMatching(/explicitly/) });
});

test("refuses the test database", () => {
  expect(checkDeployTarget({ DATABASE_URL: "postgresql://h2h:h2h@localhost:54329/h2h" }, ["--yes"]).ok).toBe(false);
  expect(checkDeployTarget({ DIRECT_URL: "postgresql://u:p@db.example.com:5432/h2h_test" }, ["--yes"]).ok).toBe(false);
});

test("a remote database needs --yes", () => {
  expect(checkDeployTarget({ DIRECT_URL: PROD }, [])).toMatchObject({ ok: false, reason: expect.stringMatching(/--yes/) });
  expect(checkDeployTarget({ DIRECT_URL: PROD }, ["--yes"])).toEqual({
    ok: true,
    url: PROD,
    host: "aws-0-ap-northeast-2.pooler.supabase.com:5432",
  });
});

test("DIRECT_URL wins over the pooled DATABASE_URL; local Supabase needs no --yes", () => {
  const r = checkDeployTarget(
    { DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", DATABASE_URL: "postgresql://x@pooler:6543/postgres" },
    [],
  );
  expect(r).toMatchObject({ ok: true, host: "127.0.0.1:54322" });
});

test("rejects malformed and non-postgres URLs", () => {
  expect(checkDeployTarget({ DIRECT_URL: "not a url" }, ["--yes"]).ok).toBe(false);
  expect(checkDeployTarget({ DIRECT_URL: "mysql://u@h:3306/db" }, ["--yes"]).ok).toBe(false);
});
