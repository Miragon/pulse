// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import * as widgets from "./index.js"

/** A piece missing from `/widgets` is a piece no connector can import. */
describe("the /widgets entry", () => {
  it.each([
    "ListTable",
    "COLUMN_BREAKPOINTS",
    "Th",
    "Td",
    "TableEmptyState",
    "SettingsCard",
    "SettingsField",
    "SettingsInput",
    "NativeSelect",
    "BpmnHeatmapWidget",
    "HeatValuesTable",
    "NamedId",
    "countTone",
    "severityTone",
  ])("exports %s", (name) => {
    expect(widgets).toHaveProperty(name)
    expect(widgets[name as keyof typeof widgets]).toBeDefined()
  })
})
