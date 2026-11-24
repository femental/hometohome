import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/server/jobs/run", () => ({
  runJob: vi.fn(async (name: string) => (name === "frequent" ? { requestExpired: 1, paymentExpired: 0, reminders: 2 } : null)),
}));

import { GET } from "@/app/api/cron/[job]/route";
import { runJob } from "@/server/jobs/run";

const call = (job: string, auth?: string) =>
  GET(new Request(`http://localhost/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }), {
    params: Promise.resolve({ job }),
  });

beforeEach(() => vi.stubEnv("CRON_SECRET", "s3cret"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("missing or wrong bearer → 401 and no job runs", async () => {
  expect((await call("frequent")).status).toBe(401);
  expect((await call("frequent", "Bearer nope")).status).toBe(401);
  expect(runJob).not.toHaveBeenCalled();
});

test("no CRON_SECRET configured → 401 even with an empty bearer", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await call("frequent", "Bearer ")).status).toBe(401);
  expect(runJob).not.toHaveBeenCalled();
});

test("right secret → 200 with the job's counts; unknown job → 404", async () => {
  const ok = await call("frequent", "Bearer s3cret");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ requestExpired: 1, paymentExpired: 0, reminders: 2 });
  expect((await call("nope", "Bearer s3cret")).status).toBe(404);
});
