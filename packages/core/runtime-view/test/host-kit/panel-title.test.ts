import { describe, expect, test } from "vitest"
import { MIGRATION_PLAN_VIEW } from "../../dev/webview/fixtures/migration-plan.js"
import { MIGRATION_VIEW } from "../../dev/webview/fixtures/migration.js"
import { PanelTitle } from "../../src/host-kit/panels/panel-title.js"

describe("the title of a migration plan editor", () => {
  test("names the file and the engine it checks the plan on", () => {
    expect(
      PanelTitle.of({ status: "ready", view: MIGRATION_PLAN_VIEW, refreshing: false }, "x"),
    ).toBe("order-fulfillment-v6-to-v7.migration.json · local")
  })

  test("differs from the migration tab's, which names the process and its versions", () => {
    const tab = PanelTitle.of({ status: "ready", view: MIGRATION_VIEW, refreshing: false }, "x")

    expect(tab).toBe("Order fulfillment v6 → v7 · local")
    expect(tab).not.toContain(MIGRATION_PLAN_VIEW.fileName)
  })

  test("keeps the file's name under a problem and before the plan is read", () => {
    const problem = { title: "Can't reach local.", detail: "", canEditConnection: true }

    expect(
      PanelTitle.of(
        {
          status: "failed",
          problem,
          engine: MIGRATION_PLAN_VIEW.engine,
          staleView: MIGRATION_PLAN_VIEW,
        },
        "x",
      ),
    ).toBe("order-fulfillment-v6-to-v7.migration.json · local")
    expect(
      PanelTitle.of(
        {
          status: "loading",
          title: MIGRATION_PLAN_VIEW.fileName,
          engine: MIGRATION_PLAN_VIEW.engine,
        },
        "order-fulfillment-v6-to-v7.migration.json",
      ),
    ).toBe("order-fulfillment-v6-to-v7.migration.json")
  })
})
