import { describe, expect, it } from "vitest"
import { loadCatalog } from "../catalog/catalog.js"
import { ENGINES } from "./index.js"

describe("ENGINES", () => {
  it("has one adapter per engine, named like its key", () => {
    expect(Object.keys(ENGINES)).toEqual(["operaton", "cibseven", "camunda7"])
    for (const [name, adapter] of Object.entries(ENGINES)) expect(adapter.name).toBe(name)
  })

  it("loads the catalog of its engine; they are all the same while no engine diverges", () => {
    expect(ENGINES.camunda7.catalog).toBe(loadCatalog())
    expect(ENGINES.operaton.catalog).toEqual(loadCatalog())
    expect(ENGINES.cibseven.catalog).toEqual(loadCatalog())
  })
})
