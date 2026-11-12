import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      // src/: the parser's tests and the shared fixtures; test/: the JSON Schema against them.
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
      coverage: {
        // Ratchet: each floor is the measured value rounded down. Raise when you push
        // coverage up; never lower. Baselined 2026-11-09 as the package was created from the
        // CLI's config checks: measured statements 99.53 / branches 98.84 / functions 100 /
        // lines 100.
        thresholds: { statements: 99, branches: 98, functions: 100, lines: 100 },
      },
    },
  }),
)
