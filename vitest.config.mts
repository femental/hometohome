import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = {
  // `server-only` throws outside the react-server condition; tests import server modules directly.
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)) } },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/smoke.test.ts"],
          // next-intl's ESM imports `next/server` without an extension; Node's resolver rejects that
          // unless Vite processes the package.
          server: { deps: { inline: ["next-intl"] } },
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
