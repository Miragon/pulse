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
        // Ratchet: the measured coverage of 2026-11-16 (99.09 / 100 / 96.96 / 100); what stays
        // out is the caller of a page that shows no view, which nothing calls. Raise, never lower.
        thresholds: { statements: 99, branches: 100, functions: 96, lines: 100 },
      },
    },
  }),
)
