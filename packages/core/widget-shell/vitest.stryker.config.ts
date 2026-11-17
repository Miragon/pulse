import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config"
import base from "./vitest.config.js"

// Mutation runs (Stryker) execute the suite hundreds of times against mutated sources. Coverage
// collection would only slow that down, and the coverage THRESHOLDS would poison the result: a
// threshold failure reads as a killed mutant even when every test passed. Only the web app's server
// rules are mutated (the sign-in's seal, cookies, return path and CSRF check, the forward of a
// page's call, the token's renewal, the build's files, the security headers, the sessions signed
// out, the session's refusal, the sign-out and the session route), and src/web's suites test
// them, so the rest of the package's suite (the view half under happy-dom included) stays out:
// mergeConfig appends to a list, so the include is replaced after the merge.
const merged: ViteUserConfig = mergeConfig(
  base,
  defineConfig({ test: { coverage: { enabled: false } } }),
)

export default defineConfig({
  ...merged,
  test: { ...merged.test, include: ["src/web/**/*.test.ts"] },
})
