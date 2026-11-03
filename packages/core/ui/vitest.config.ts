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
        // statements 96.10 / branches 94.31 / functions 94.55 / lines 97.16.
        thresholds: { statements: 96, branches: 94, functions: 94, lines: 97 },
      },
    },
  }),
)
