import { describe, expect, it } from "vitest"
import * as testing from "./index.js"

/**
 * The published entry, name by name: knip never reports what an entry exports, so a name added
 * or dropped is held here and decided in review. Types are erased at runtime: this locks the
 * runtime names, each with a value (vitest would keep a type re-exported without `type` as a name
 * without one; tsc refuses that re-export, TS1205).
 */
describe("the /testing entry", () => {
  it("exports exactly the recording module server and its server context", () => {
    expect(Object.keys(testing).sort()).toEqual(["recordingModuleServer", "testServerContext"])
    for (const [name, value] of Object.entries(testing)) expect(value, name).toBeDefined()
  })
})
