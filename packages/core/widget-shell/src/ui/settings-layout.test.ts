import { describe, expect, it } from "vitest"
import { collectLayoutWidgets } from "@miragon/mcp-toolkit-core"
import { filterLayoutToWidgets, settingsLayout } from "./settings-layout.js"

const sectionsFor = (widgetIds?: string[]) => collectLayoutWidgets(settingsLayout(widgetIds))

describe("settingsLayout", () => {
  it("renders the shell's language section without any host registry", () => {
    // A host without HostWidgetsProvider still gets the shell's section, never an empty page.
    expect(sectionsFor()).toEqual(["shell:settings"])
    expect(sectionsFor([])).toEqual(["shell:settings"])
  })

  it("adds a row for every module's `<module>:settings` widget, in registration order", () => {
    expect(
      sectionsFor([
        "camunda7:engine-health",
        "camunda7:settings",
        "analytics:settings",
        "shell:kpi-grid",
        "shell:settings-page",
      ]),
    ).toEqual(["shell:settings", "camunda7:settings", "analytics:settings"])
  })

  it("pins the shell's section first, wherever the host registered it", () => {
    expect(sectionsFor(["analytics:settings", "shell:settings", "camunda7:settings"])).toEqual([
      "shell:settings",
      "analytics:settings",
      "camunda7:settings",
    ])
  })

  it("picks up a CUSTOM module's section nothing else has heard of", () => {
    // A server composed from the published packages contributes its section with no other edit.
    expect(sectionsFor(["analytics:settings", "acme:settings"])).toEqual([
      "shell:settings",
      "analytics:settings",
      "acme:settings",
    ])
  })

  it("matches the convention exactly — a lookalike id contributes no section", () => {
    expect(sectionsFor(["acme:settings-advanced", "acme:settingsfoo", "settings"])).toEqual([
      "shell:settings",
    ])
  })

  it("lists no section twice when ids repeat across merged registries", () => {
    expect(sectionsFor(["analytics:settings", "camunda7:settings", "analytics:settings"])).toEqual([
      "shell:settings",
      "analytics:settings",
      "camunda7:settings",
    ])
  })
})

describe("filterLayoutToWidgets", () => {
  it("drops cells whose widget id resolves nowhere, and the rows they empty", () => {
    const layout = settingsLayout(["analytics:settings", "acme:settings"])
    const filtered = filterLayoutToWidgets(layout, {
      "shell:settings": () => null,
      "acme:settings": () => null,
    })
    expect(collectLayoutWidgets(filtered)).toEqual(["shell:settings", "acme:settings"])
  })

  it("keeps every cell a host can resolve, tabs included", () => {
    const layout = {
      tabs: [
        { label: "A", rows: [{ row: [{ widget: "x:one", props: {} }] }] },
        { label: "B", rows: [{ row: [{ widget: "x:two", props: {} }] }] },
      ],
    }
    const filtered = filterLayoutToWidgets(layout, { "x:one": () => null })
    expect(collectLayoutWidgets(filtered)).toEqual(["x:one"])
    expect("tabs" in filtered && filtered.tabs[1]?.rows).toEqual([])
  })
})
