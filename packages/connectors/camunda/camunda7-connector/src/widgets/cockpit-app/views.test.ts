import { describe, expect, it } from "vitest"
import { collectLayoutWidgets } from "@miragon/mcp-toolkit-core"
import {
  filterLayoutToWidgets,
  SHELL_SETTINGS_PAGE_WIDGET,
} from "@miragon/pulse-widget-shell/widgets"
import { cockpitViews } from "./views.js"

describe("cockpitViews.settings", () => {
  // #346: engine scope is irrelevant to per-user preferences.
  it("renders the shell's settings page, whatever the route", () => {
    expect(collectLayoutWidgets(cockpitViews.settings({ engine: "prod-a" }))).toEqual([
      SHELL_SETTINGS_PAGE_WIDGET,
    ])
  })
})

describe("the cockpit views through filterLayoutToWidgets", () => {
  it("keeps every cell a host can resolve", () => {
    const layout = cockpitViews.overview({ engine: "prod-a" })
    const widgets = Object.fromEntries(
      collectLayoutWidgets(layout).map((id) => [id, () => null] as const),
    )
    expect(collectLayoutWidgets(filterLayoutToWidgets(layout, widgets))).toEqual(
      collectLayoutWidgets(layout),
    )
  })

  it("drops the settings page in a host that bundles no shell widgets", () => {
    const layout = cockpitViews.settings({ engine: "prod-a" })
    expect(collectLayoutWidgets(filterLayoutToWidgets(layout, {}))).toEqual([])
  })
})
