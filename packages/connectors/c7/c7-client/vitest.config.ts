import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      coverage: {
        // Ratchet: frozen 2 points under the baseline. Raise when you push
        // coverage up; never lower. Raised 2026-10-08 with the engine error
        // mapping under test, again with its review fixes (measured
        // statements 46.02 / branches 34.17 / functions 47.31 / lines 46.14).
        // Raised 2026-10-09 with the SDK-bound reads under test (#328;
        // measured statements 54.1 / branches 47.7 / functions 61.71 / lines
        // 53.16). Raised 2026-10-10 with the engine-date read side under test
        // (#335; measured statements 56.32 / branches 50.13 / functions 65.73
        // / lines 55.12). Raised 2026-11-03 as the pure rules moved to engine-core (now c7-core)
        // and the client's own wire came under test (src/wire.test.ts; measured statements
        // 61.69 / branches 56.48 / functions 77.57 / lines 61.15).
        thresholds: { statements: 59, branches: 54, functions: 75, lines: 59 },
      },
    },
  }),
)
