import { defineConfig } from "vitest/config";

const shared = { resolve: { tsconfigPaths: true } };

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/smoke.test.ts"],
        },
      },
      {
        ...shared,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: "tests/db/global-setup.ts",
          fileParallelism: false,
        },
      },
    ],
  },
});
