import { describe, expect, it } from "vitest"
import * as widgets from "./index.js"

/**
 * The ./widgets entry, name by name: it exports what a composition root's view registry spreads
 * (apps/mcp-server's view-registry.ts, the template's) and what a page hands `mountPage` for the
 * cockpit (apps/web's `cockpitAfterFailedStart`), so a name added or dropped is a decision
 * made in review. Types are erased at runtime: this locks the runtime names (knip does not report
 * an entry's own exports), each with a value (vitest would keep a type re-exported without `type`
 * as a name without one; tsc refuses that re-export, TS1205).
 */
describe("the ./widgets entry", () => {
  it("exports exactly the engine views and the cockpit's data after a page's failed start", () => {
    expect(Object.keys(widgets).sort()).toEqual(["cockpitAfterFailedStart", "engineViews"])
    for (const [name, value] of Object.entries(widgets)) expect(value, name).toBeDefined()
  })
})
