import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      coverage: {
        // Ratchet: frozen 2 points under the baseline. Raise when you push
        // coverage up; never lower. Re-baselined UP 2026-08-17: the Postgres
        // adapters left the measurement (shared `coverage.exclude`: they are
        // only executable under `pnpm test:pg`), so the numbers now describe
        // the code this run actually exercises; measured statements 85.35 /
        // branches 88.55 / functions 95.04 / lines 86.86. Raised 2026-10-08
        // (#324: the shared boot, HTTP edge and body-capped listener landed
        // with their suites): measured 90.76 / 90.94 / 96.31 / 91.91. Raised
        // again with the #324 review fixes (in-flight budget, guard before the
        // body): measured 91.24 / 91.57 / 96.47 / 92.32. Raised again with
        // #331 (session cleanup gone, `oauthFromEnv` fully covered): measured
        // 92.66 / 93.26 / 97.22 / 93.45. Raised again with the pre-production
        // compat removal (#322: the supportsToolsets pass-through, mergeRawSlice
        // and the v1→v3 migration steps gone): measured 93.02 / 93.51 / 97.34 / 93.79.
        // Raised again with #338 (the askAiPrompt primitive and its fence
        // fully covered): measured 93.4 / 92.96 / 97.59 / 94.04.
        // Raised again with the brand-kit foundation (the testing gates, the
        // tone model and the locale formatters landed with their suites):
        // measured 94.23 / 93.69 / 96.77 / 95.1. Branches raised with its
        // review fixes (colour gate, cascade model, lone-symbol rule, each
        // with its negative cases): measured 94.64 / 94.06 / 97.01 / 95.48.
        // Raised again with the toolkit 2.8 review fixes: measured
        // 95.14 / 94.82 / 97.06 / 96.05. Raised again with the kit layout
        // (describeError's mapping table, ListTable's region and column rules,
        // the BPMN token module, the heat ramp and the type-scale gate, each
        // with its suite): measured 97.33 / 95.32 / 97.44 / 98.45.
        thresholds: { statements: 95, branches: 93, functions: 95, lines: 96 },
      },
    },
  }),
)
