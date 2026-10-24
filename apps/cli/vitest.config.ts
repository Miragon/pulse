import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      clearMocks: true,
      restoreMocks: true,
      // CI runners are several times slower than developer machines, especially with coverage
      // instrumentation; property tests and catalog-wide tests need headroom beyond the 5 s default.
      testTimeout: 15_000,
      coverage: {
        include: ["src/**/*.ts", "scripts/catalog/**/*.ts", "scripts/exe/**/*.ts"],
        exclude: ["**/*.test.ts", "src/bin/**", "src/**/types.ts", "scripts/catalog/openapi.ts"],
        // Ratchet: the floors the CLI brought along (measured at the import: statements 99.73 /
        // branches 97.62 / functions 99.86 / lines 99.88). Raise when you push coverage up;
        // never lower.
        thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  }),
)
