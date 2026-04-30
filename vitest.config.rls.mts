import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "next/server": path.resolve(__dirname, "apps/web/node_modules/next/server"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    globals: true,
    exclude: ["**/e2e/**", "**/node_modules/**"],
    env: {
      // Loaded from .env.test.local by helpers.ts via dotenv — this is a
      // belt-and-suspenders reminder that RLS tests need the local stack running.
    },
  },
});
