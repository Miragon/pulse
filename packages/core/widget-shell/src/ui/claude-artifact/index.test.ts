// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import * as claudeArtifact from "./index.js"

/**
 * The published entry, name by name: a name added here is a promise to every customer, a name
 * dropped a breaking change, so either is a decision made in review, not a side effect. Types are
 * erased at runtime: this locks the runtime names (knip does not report an entry's own exports).
 */
describe("the /claude-artifact entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(claudeArtifact).sort()).toEqual([
      "ARTIFACT_PAGE_HINTS",
      "CLAUDE_RUNTIME_CODES",
      "claudeToolCaller",
      "mountClaudeArtifact",
    ])
  })
})
