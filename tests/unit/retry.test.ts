import { expect, test } from "vitest";
import { withSerializationRetry } from "@/server/bookings/retry";

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { cause: { originalCode: code } });

test("retries a deadlock (40P01) and returns the eventual result", async () => {
  let calls = 0;
  const out = await withSerializationRetry(async () => {
    calls++;
    if (calls < 3) throw pgError("40P01");
    return "ok";
  });
  expect(out).toBe("ok");
  expect(calls).toBe(3);
});

test("retries a serialization failure (40001) too", async () => {
  let calls = 0;
  await withSerializationRetry(async () => {
    calls++;
    if (calls === 1) throw pgError("40001");
  });
  expect(calls).toBe(2);
});

test("gives up after 3 attempts and rethrows the last error", async () => {
  let calls = 0;
  await expect(
    withSerializationRetry(async () => {
      calls++;
      throw pgError("40P01");
    }),
  ).rejects.toThrow("pg 40P01");
  expect(calls).toBe(3);
});

test("does not retry other errors", async () => {
  let calls = 0;
  await expect(
    withSerializationRetry(async () => {
      calls++;
      throw pgError("23P01");
    }),
  ).rejects.toThrow("pg 23P01");
  expect(calls).toBe(1);
});

test("recognises the Prisma adapter shape meta.driverAdapterError.cause.originalCode", async () => {
  let calls = 0;
  await withSerializationRetry(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("p"), { meta: { driverAdapterError: { cause: { originalCode: "40P01" } } } });
  });
  expect(calls).toBe(2);
});
