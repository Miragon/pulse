import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.d.ts"],
        thresholds: { lines: 98, statements: 98, functions: 100, branches: 94 },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            env: { LC_ALL: "C.UTF-8" },
            include: ["test/**/*.test.ts"],
          },
        },
      ],
    },
  }),
)
