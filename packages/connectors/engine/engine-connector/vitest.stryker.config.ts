import { defineConfig, mergeConfig } from "vitest/config"
import base from "./vitest.config"

// Mutation runs (Stryker) execute the suite hundreds of times against mutated
// sources — coverage collection would only slow that down, and the coverage
// THRESHOLDS would poison the result: a threshold failure reads as a killed
// mutant even when every test passed.
const config = mergeConfig(base, defineConfig({ test: { coverage: { enabled: false } } }))

// Server-side suites only (mergeConfig would CONCAT include arrays, so this is
// assigned after the merge): the widget suites need the per-file DOM isolation
// that the Stryker vitest runner disables for speed, and the mutation scope
// (src/data + src/lib) is covered by these suites anyway.
config.test!.include = [
  "src/*.test.ts",
  "src/data/**/*.test.ts",
  "src/lib/**/*.test.ts",
  "src/tools/**/*.test.ts",
  "src/widget-tools/**/*.test.ts",
]

export default config
