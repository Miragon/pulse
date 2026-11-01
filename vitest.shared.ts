import { coverageConfigDefaults, defineConfig } from "vitest/config"

/**
 * Shared vitest base merged into every package-level vitest.config.ts via
 * `mergeConfig`. Centralizes the coverage baseline: v8 provider, per-package
 * output under `<package>/coverage/`. Each package's vitest.config.ts pins
 * ratchet thresholds frozen just under its measured baseline — a change that
 * drops coverage below them fails `pnpm test`.
 */
export const sharedConfig = defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      enabled: true,
      // json-summary feeds scripts/fitness-report.mjs (pnpm fitness).
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      exclude: [...coverageConfigDefaults.exclude],
    },
  },
})
