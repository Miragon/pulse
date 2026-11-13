import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      coverage: {
        // Ratchet: each floor is the measured value rounded down. Raise when you push
        // coverage up; never lower. Baselined 2026-11-01 as the package was created from
        // the toolkit's 2.8.1 design kit and widget-shell's host-free UI, raised the same day
        // with the render suite and the portal seam test: measured
        // statements 96.10 / branches 94.31 / functions 94.55 / lines 97.16. Raised 2026-11-13
        // with the form primitives and their suites: measured
        // statements 97.37 / branches 95.23 / functions 96.31 / lines 98.25.
        thresholds: { statements: 97, branches: 95, functions: 96, lines: 98 },
      },
    },
  }),
)
