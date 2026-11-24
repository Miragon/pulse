import { describe, expect, test } from "vitest"
import { MigrationPlanVersions } from "../../src/index.js"

const V1 = { id: "invoice:1:a", version: 1 }
const V2 = { id: "invoice:2:b", version: 2 }
const V2_OF_TENANT = { id: "invoice:2:c", version: 2, tenantId: "b" }

describe("a version number", () => {
  test("names the one definition that has it", () => {
    expect(MigrationPlanVersions.pick([V1, V2], 2)).toStrictEqual({ kind: "found", candidate: V2 })
  })

  test("names none when no definition has it", () => {
    expect(MigrationPlanVersions.pick([V1, V2], 3)).toStrictEqual({ kind: "missing" })
    expect(MigrationPlanVersions.pick([], 1)).toStrictEqual({ kind: "missing" })
  })

  test("names none when several have it, and counts them", () => {
    expect(MigrationPlanVersions.pick([V1, V2, V2_OF_TENANT], 2)).toStrictEqual({
      kind: "ambiguous",
      count: 2,
    })
  })
})

describe("a list that is already narrowed", () => {
  test("names its one entry", () => {
    expect(MigrationPlanVersions.only([V2])).toStrictEqual({ kind: "found", candidate: V2 })
  })

  test("names none when it is empty", () => {
    expect(MigrationPlanVersions.only([])).toStrictEqual({ kind: "missing" })
  })

  test("names none when it holds several, and counts them", () => {
    expect(MigrationPlanVersions.only([V2, V2_OF_TENANT])).toStrictEqual({
      kind: "ambiguous",
      count: 2,
    })
  })
})
