import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    projects: [
      {
        resolve: { alias: { "@": path.resolve(__dirname) } },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias: { "@": path.resolve(__dirname) } },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/setup-integration.ts"],
          // Live credentials from the developer's .env are scrubbed in
          // tests/helpers/test-env.ts, re-applied before every test. Setting
          // them here does not hold — Vitest re-applies .env per test file.
          // One shared database: files must not interleave their truncations.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
