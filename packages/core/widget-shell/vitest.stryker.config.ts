import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config"
import base from "./vitest.config.js"

// Mutation runs (Stryker) execute the suite hundreds of times against mutated sources. Coverage
// collection would only slow that down, and the coverage THRESHOLDS would poison the result: a
// threshold failure reads as a killed mutant even when every test passed. Only the web app's server
// rules (the sign-in's seal, cookies, return path and CSRF check, the forward of a page's call, the
// token's renewal, the build's files, the security headers, the sessions signed out, the session's
// refusal, the sign-out and the session route), the gate's token rules (the JWT verifier), the
// identity provider's discovery, the generic OpenID Connect provider, Microsoft Entra ID, a page's
// calls (src/ui/page-reads/page-reader.ts) and a Claude artifact's caller
// (src/ui/claude-artifact/claude-tool-caller.ts) are mutated, and src/web's suites, the OAuth
// suites and the suites of the page reader and the caller (plain Node) test them, so the rest of
// the package's suite (the view half under happy-dom included) stays out: mergeConfig appends to
// a list, so the include is replaced after the merge.
const merged: ViteUserConfig = mergeConfig(
  base,
  defineConfig({ test: { coverage: { enabled: false } } }),
)

export default defineConfig({
  ...merged,
  test: {
    ...merged.test,
    include: [
      "src/web/**/*.test.ts",
      "src/oauth-*.test.ts",
      "src/ui/page-reads/page-reader.test.ts",
      "src/ui/claude-artifact/claude-tool-caller.test.ts",
    ],
  },
})
