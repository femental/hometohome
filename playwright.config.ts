import { defineConfig, devices } from "@playwright/test";
import { APP_URL, E2E_PORT, e2eEnv } from "./e2e/env";

/** E2E against local Supabase + a dev server in fake-payment mode. Run with `npm run e2e`. */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: APP_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx next dev --port ${E2E_PORT}`,
    url: `${APP_URL}/en/faq`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: e2eEnv(),
  },
});
