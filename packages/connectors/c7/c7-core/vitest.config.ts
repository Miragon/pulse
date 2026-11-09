import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      // src/: the package's tests; scripts/: the route generator's, over the one spec.
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      coverage: {
        // The generated route tables are data: counted, their 438 lines would read as covered
        // code and hide a drop of the floors below.
        exclude: ["src/generated/**"],
        // Ratchet: each floor is the measured value rounded down. Raise when you push
        // coverage up; never lower. Baselined 2026-11-02 as the package was created from the
        // CLI's workflow layer, raised the same day with the waitId and default-option tests:
        // measured statements 99.60 / branches 98.18 / functions 99.19 / lines 99.65.
        thresholds: { statements: 99, branches: 98, functions: 99, lines: 99 },
      },
    },
  }),
)
