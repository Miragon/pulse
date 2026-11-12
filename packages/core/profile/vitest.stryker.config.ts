import { defineConfig, mergeConfig } from "vitest/config"
import base from "./vitest.config.js"

// Mutation runs (Stryker) execute the suite hundreds of times against mutated
// sources. Coverage collection would only slow that down, and the coverage
// THRESHOLDS would poison the result: a threshold failure reads as a killed
// mutant even when every test passed. Every suite of the package runs in node,
// so the whole suite stays in.
export default mergeConfig(base, defineConfig({ test: { coverage: { enabled: false } } }))
