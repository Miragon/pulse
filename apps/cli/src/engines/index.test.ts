import { describe, expect, it } from "vitest"
import { loadCatalog } from "../catalog/catalog.js"
import { ENGINES } from "./index.js"

describe("ENGINES", () => {
  it("has one adapter per engine, named like its key", () => {
    expect(Object.keys(ENGINES)).toEqual(["operaton", "cibseven", "camunda7"])
    for (const [name, adapter] of Object.entries(ENGINES)) expect(adapter.name).toBe(name)
  })

  it("shares the one generated catalog", () => {
    for (const adapter of Object.values(ENGINES)) expect(adapter.catalog).toBe(loadCatalog())
  })
})
