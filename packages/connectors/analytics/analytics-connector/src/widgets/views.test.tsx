// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { cleanup, render } from "@testing-library/react"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { TestViewHost, type ViewComponent } from "@miragon/pulse-widget-shell/widgets"
import { createPlugin } from "../plugin.js"
import { analyticsHostWidgets, analyticsViews, FleetLandscape } from "./views.js"

// Each widget renders a marker with the props it got; each description names itself.
const { widget } = vi.hoisted(() => ({
  widget: (name: string) => (props: Record<string, unknown>) => (
    <p data-widget={name}>{JSON.stringify(props)}</p>
  ),
}))
vi.mock("./analytics-dashboard/execution-summary-kpi.js", () => ({
  ExecutionSummaryKpi: widget("ExecutionSummaryKpi"),
}))
vi.mock("./analytics-dashboard/execution-performance-kpi.js", () => ({
  ExecutionPerformanceKpi: widget("ExecutionPerformanceKpi"),
}))
vi.mock("./analytics-dashboard/definition-breakdown.js", () => ({
  ProcessDefinitionBreakdown: widget("ProcessDefinitionBreakdown"),
}))
vi.mock("./analytics-dashboard/activity-bottleneck-table.js", () => ({
  ActivityBottleneckTable: widget("ActivityBottleneckTable"),
}))
vi.mock("./period-compare.js", () => ({ PeriodCompareWidget: widget("PeriodCompareWidget") }))
vi.mock("./version-compare.js", () => ({ VersionCompareWidget: widget("VersionCompareWidget") }))
vi.mock("./engine-compare.js", () => ({ EngineCompareWidget: widget("EngineCompareWidget") }))
vi.mock("./engine-landscape.js", () => ({ EngineLandscapeWidget: widget("EngineLandscapeWidget") }))
vi.mock("./bpmn-heatmap.js", () => ({ AnalyticsBpmnHeatmap: widget("AnalyticsBpmnHeatmap") }))
vi.mock("./model-descriptions.js", () => ({
  describeBpmnHeatmap: (data: unknown) => `describeBpmnHeatmap(${JSON.stringify(data)})`,
}))

afterEach(() => {
  cleanup()
})

/** Every view-bound tool the plugin registers. */
function viewTools(): string[] {
  const recording = recordingModuleServer()
  createPlugin({ url: "http://prometheus.example", engineIds: ["prod-a"] }).register(
    recording.server,
  )
  return [...recording.tools.keys()].filter((name) => name.startsWith("analytics_show_"))
}

const DATA = { engines: ["prod-a"] }

function renderView(name: string) {
  const contexts: string[] = []
  const view = analyticsViews[name] as ViewComponent<unknown>
  render(
    <TestViewHost onModelContext={(text) => contexts.push(text)}>
      {createElement(view, { data: DATA })}
    </TestViewHost>,
  )
  const widgets = [...document.querySelectorAll("[data-widget]")].map((el) => [
    el.getAttribute("data-widget"),
    JSON.parse(el.textContent ?? "{}") as unknown,
  ])
  return { widgets, contexts }
}

const described = (name: string) => `${name}(${JSON.stringify(DATA)})`

describe("analyticsViews", () => {
  it("holds a view for every analytics show tool, and nothing else", () => {
    expect(Object.keys(analyticsViews).sort()).toEqual(viewTools().sort())
  })

  it.each([
    [
      "analytics_show_dashboard",
      [
        "ExecutionSummaryKpi",
        "ExecutionPerformanceKpi",
        "ProcessDefinitionBreakdown",
        "ActivityBottleneckTable",
      ],
      // The tool result gives the model the figures: no model context.
      [],
    ],
    ["analytics_show_period_compare", ["PeriodCompareWidget"], []],
    ["analytics_show_version_compare", ["VersionCompareWidget"], []],
    ["analytics_show_engine_compare", ["EngineCompareWidget"], []],
    ["analytics_show_engine_landscape", ["EngineLandscapeWidget"], []],
    // Its tool result is a summary: the view tells the model the hottest and slowest element.
    ["analytics_show_bpmn_heatmap", ["AnalyticsBpmnHeatmap"], ["describeBpmnHeatmap"]],
  ])("%s renders %j on its data and tells the model %j", (name, widgets, descriptions) => {
    const rendered = renderView(name)
    expect(rendered.widgets).toEqual(widgets.map((w) => [w, { data: DATA }]))
    expect([...rendered.contexts].sort()).toEqual(descriptions.map(described).sort())
  })
})

describe("analyticsHostWidgets", () => {
  it("offers the fleet's landscape and the process flow's heatmap and legend by raw id", () => {
    expect(Object.keys(analyticsHostWidgets)).toEqual([
      "analytics:engine-landscape",
      "analytics:process-heatmap",
      "analytics:process-heatmap-legend",
    ])
  })

  it.each([
    [{ engine: ["prod-a", "prod-b"] }, { data: null, engine: ["prod-a", "prod-b"] }],
    [{ engine: "prod-a" }, { data: null }],
    [{ engine: ["prod-a", 7] }, { data: null }],
    [{}, { data: null }],
  ])("the fleet landscape takes %j as %j", (props, expected) => {
    render(
      <TestViewHost>
        <FleetLandscape {...props} />
      </TestViewHost>,
    )
    const marker = document.querySelector("[data-widget=EngineLandscapeWidget]")
    expect(JSON.parse(marker?.textContent ?? "null")).toEqual(expected)
  })
})
