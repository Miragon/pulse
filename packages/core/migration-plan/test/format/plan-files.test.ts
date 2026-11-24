import { describe, expect, test } from "vitest"
import { MigrationPlanFiles } from "../../src/index.js"

const PLAN = { bpmnProcessId: "order-fulfillment", source: { version: 3 }, target: { version: 4 } }

describe("the plan files", () => {
  test("are named by the process and the two version numbers", () => {
    expect(MigrationPlanFiles.nameOf(PLAN)).toBe("order-fulfillment-v3-to-v4.migration.json")
  })

  test("lie in the migrations folder of .pulse", () => {
    expect(MigrationPlanFiles.pathOf(PLAN)).toBe(
      ".pulse/migrations/order-fulfillment-v3-to-v4.migration.json",
    )
  })

  test("name an older target as it is", () => {
    const back = { ...PLAN, source: { version: 4 }, target: { version: 3 } }

    expect(MigrationPlanFiles.nameOf(back)).toBe("order-fulfillment-v4-to-v3.migration.json")
  })

  test.each([
    "invoice.migration.json",
    "plans/invoice.migration.json",
    "C:\\plans\\invoice.migration.json",
    MigrationPlanFiles.pathOf(PLAN),
  ])("end in the suffix: %s", (path) => {
    expect(MigrationPlanFiles.isPlanPath(path)).toBe(true)
  })

  test.each([
    "",
    ".migration.json",
    "plans/.migration.json",
    "plans\\.migration.json",
    "invoice.json",
    "invoice.migration.json.bak",
    "invoice.migration.json/",
  ])("need a name before the suffix: %j", (path) => {
    expect(MigrationPlanFiles.isPlanPath(path)).toBe(false)
  })
})
