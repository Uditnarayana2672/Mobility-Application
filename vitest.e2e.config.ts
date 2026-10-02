import { defineConfig } from "vitest/config";
import path from "path";

/** Browser end-to-end tests (npm run e2e). Slow: starts the dev server and a headless Edge/Chrome. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/e2e/**/*.e2e.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
