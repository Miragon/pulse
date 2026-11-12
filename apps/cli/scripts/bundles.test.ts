import type { UserConfig } from "tsdown"
import { describe, expect, it } from "vitest"
import npmBundle from "../tsdown.config.js"
import standaloneBundle from "../tsdown.standalone.config.js"

function commentsOf(config: UserConfig): unknown {
  const output = config.outputOptions
  return typeof output === "function" ? output : output?.comments
}

/**
 * apps/cli/CLAUDE.md: both bundles leave out comments but legal ones (owner decision
 * 2026-11-12). Only the npm bundle has a byte budget, and no bundled module brings a legal comment
 * today, so a budget alone would miss a standalone bundle that keeps comments or a build that
 * drops legal ones.
 */
describe("the CLI's bundles", () => {
  it("keep only legal comments", () => {
    expect(commentsOf(npmBundle)).toEqual({ legal: true, annotation: false, jsdoc: false })
  })

  it("keep the same comments, the standalone bundle as the npm one", () => {
    expect(commentsOf(standaloneBundle)).toEqual(commentsOf(npmBundle))
  })
})
