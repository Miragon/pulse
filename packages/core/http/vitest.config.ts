import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared.js"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      // test/: the units over fakes and the conformance cases over loopback engines (Node's
      // fetch on real sockets); the package's src/ holds no test.
      include: ["test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        // Ratchet: each floor is the measured value rounded down. Raise when you push
        // coverage up; never lower. Baselined 2026-11-09 as the package was created: measured
        // statements 99.83 / branches 100 / functions 99.39 / lines 100 (the one function left
        // is the catch handler of a cancel that never fails).
        thresholds: { statements: 99, branches: 100, functions: 99, lines: 100 },
      },
    },
  }),
)
