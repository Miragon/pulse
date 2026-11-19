import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.{ts,tsx}"],
      // The build tests run `vite build` of the whole cockpit in-process, a few seconds each.
      testTimeout: 60_000,
      hookTimeout: 120_000,
      coverage: {
        include: ["src/**/*.{ts,tsx}"],
        // The entry hands the browser's own window to startPage (start.ts), which the tests run.
        exclude: ["src/main.tsx"],
        // Ratchet: the measured coverage of 2026-11-16, all of it (a page that shows no view
        // hands mountApp no caller, so no function stays uncalled). Never lower.
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  }),
)
