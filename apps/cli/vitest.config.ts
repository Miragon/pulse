import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [
      {
        name: "markdown-as-text",
        transform: (code: string, id: string) =>
          id.endsWith(".md") ? `export default ${JSON.stringify(code)}` : undefined,
      },
    ],
    test: {
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      clearMocks: true,
      restoreMocks: true,
      // CI runners are several times slower than developer machines, especially with coverage
      // instrumentation, and in this monorepo the CLI's suite shares a 4-core runner with every
      // other package's tests: the property tests that drive the CLI through many scenarios took
      // more than 15 s there (#445), so they get a minute.
      testTimeout: 60_000,
      coverage: {
        include: ["src/**/*.ts", "scripts/catalog/**/*.ts", "scripts/exe/**/*.ts"],
        // Only the entry point stays out: importing it runs the CLI, so no unit test can.
        exclude: ["**/*.test.ts", "src/bin/pulse-cli.ts"],
        // Ratchet: the floors the CLI brought along (measured with the Node runtime counted:
        // statements 99.40 / branches 97.18 / functions 99.64 / lines 99.59). Raise when you push
        // coverage up; never lower.
        thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  }),
)
