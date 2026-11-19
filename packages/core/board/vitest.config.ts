import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  }),
)
