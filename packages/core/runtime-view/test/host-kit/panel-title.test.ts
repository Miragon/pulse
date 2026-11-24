import { describe, expect, test } from "vitest"
import { MIGRATION_PLAN_VIEW } from "../../dev/webview/fixtures/migration-plan.js"
import { MIGRATION_VIEW } from "../../dev/webview/fixtures/migration.js"
import { PanelTitle } from "../../src/host-kit/panels/panel-title.js"

describe("the title of a migration plan preview", () => {
  test("names the file, says it is a preview and names the engine", () => {
    expect(
      PanelTitle.of({ status: "ready", view: MIGRATION_PLAN_VIEW, refreshing: false }, "x"),
    ).toBe("order-fulfillment-v6-to-v7.migration.json · Preview · local")
  })

  test("differs from the migration tab's, which names the process and its versions", () => {
    const tab = PanelTitle.of({ status: "ready", view: MIGRATION_VIEW, refreshing: false }, "x")

    expect(tab).toBe("Order fulfillment v6 → v7 · local")
    expect(tab).not.toContain("Preview")
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
    ).toBe("order-fulfillment-v6-to-v7.migration.json · Preview · local")
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
