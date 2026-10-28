import { describe, expect, it } from "vitest"
import { parseViewToolResult } from "@miragon/mcp-toolkit-ui"
import { buildComposedView, buildSingleWidgetView } from "./server.js"

/** Pins the implicit contract with the toolkit's `McpAppView`: data under `context.stepData[<id>]`. */
describe("buildSingleWidgetView", () => {
  const data = { rows: [{ id: "pi-1" }], total: 1 }
  const view = buildSingleWidgetView({
    widget: "process-instances",
    app: "camunda7",
    dataType: "processInstances",
    data,
    title: "Instances",
    summary: "1 running instance of order-process.",
  })

  it("exposes the data under context.stepData.result with _app/_dataType routing", () => {
    expect(view.structuredContent).toEqual({
      title: "Instances",
      context: {
        keys: {},
        stepIds: ["result"],
        stepData: {
          result: {
            data,
            keys: {},
            _app: "camunda7",
            _dataType: "processInstances",
          },
        },
        errors: [],
      },
      layout: [{ row: [{ widget: "process-instances" }] }],
    })
  })

  it("emits only the model summary on the text channel — never the payload", () => {
    expect(view.content).toEqual([{ type: "text", text: "1 running instance of order-process." }])
  })

  it("round-trips the payload through parseViewToolResult for refresh callers", () => {
    expect(parseViewToolResult(view)).toEqual(data)
  })

  it("falls back to a generic widget-type summary with a derivable item count", () => {
    const fallback = buildSingleWidgetView({
      widget: "camunda7:job-panel",
      app: "camunda7",
      dataType: "jobPanel",
      data: { jobs: [], totalCount: 7 },
    })
    expect(fallback.content[0].text).toBe(
      'Rendered widget "camunda7:job-panel" (7 items). Full data is shown in the widget.',
    )
  })
})

describe("buildComposedView", () => {
  const layout = [{ row: [{ widget: "kpi-grid" }, { widget: "failure-list" }] }]

  it("keys each entry's step data by id (or result_<index>) with _app/_dataType", () => {
    const view = buildComposedView({
      app: "analytics",
      layout,
      title: "Failure overview",
      entries: [
        { id: "kpis", dataType: "dashboard", data: { totalCount: 5 } },
        { dataType: "failures", data: { patterns: [] } },
      ],
    })

    expect(view.structuredContent.title).toBe("Failure overview")
    expect(view.structuredContent.layout).toEqual(layout)
    expect(view.structuredContent.context).toEqual({
      keys: {},
      stepIds: ["kpis", "result_1"],
      stepData: {
        kpis: {
          data: { totalCount: 5 },
          keys: {},
          _app: "analytics",
          _dataType: "dashboard",
        },
        result_1: {
          data: { patterns: [] },
          keys: {},
          _app: "analytics",
          _dataType: "failures",
        },
      },
      errors: [],
    })
  })

  it("emits the explicit summary on the text channel, not the entry data", () => {
    const data = { totalCount: 5 }
    const view = buildComposedView({
      app: "analytics",
      layout,
      entries: [{ id: "kpis", dataType: "dashboard", data }],
      summary: "Failure dashboard: 5 open incidents.",
    })
    expect(view.content).toEqual([{ type: "text", text: "Failure dashboard: 5 open incidents." }])
    // The payload still round-trips structuredContent-first for refresh callers.
    expect(parseViewToolResult(view)).toEqual(data)
  })

  it("falls back to a generic summary naming title (or widgets) with the single-entry count", () => {
    const single = buildComposedView({
      app: "analytics",
      layout,
      title: "Failure overview",
      entries: [{ dataType: "dashboard", data: { totalCount: 5 } }],
    })
    expect(single.content[0].text).toBe(
      'Rendered widget "Failure overview" (5 items). Full data is shown in the widget.',
    )

    const multi = buildComposedView({
      app: "analytics",
      layout,
      entries: [
        { id: "kpis", dataType: "dashboard", data: { totalCount: 5 } },
        { dataType: "failures", data: { patterns: [] } },
      ],
    })
    expect(multi.content[0].text).toBe(
      'Rendered widget "kpi-grid, failure-list". Full data is shown in the widget.',
    )
  })

  it("unwraps multi-entry views to an object keyed by step id via parseViewToolResult", () => {
    const view = buildComposedView({
      app: "analytics",
      layout,
      entries: [
        { id: "kpis", dataType: "dashboard", data: { totalCount: 5 } },
        { dataType: "failures", data: { patterns: [] } },
      ],
    })
    expect(parseViewToolResult(view)).toEqual({
      kpis: { totalCount: 5 },
      result_1: { patterns: [] },
    })
  })
})
