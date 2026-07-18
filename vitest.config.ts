import { defineConfig } from "vitest/config";

// Runs each package's tests from a single root command (`npm test`).
// TODO: add per-package aliases here if `@ht6/shared` resolution needs help outside of workspace linking.
export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
