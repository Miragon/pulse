import { describe, expect, it } from "vitest"
import * as root from "./index.js"

/**
 * The package root, name by name: it exports what a composition root wires (apps/mcp-server's
 * setup.ts, the template), so a name added or dropped is a decision made in review. Types are
 * erased at runtime: this locks the runtime names (knip does not report an entry's own exports).
 */
describe("the package root", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(root).sort()).toEqual(["analyticsModule"])
  })
})
