// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import type { MCPServer } from "mcp-use"
import {
  settingsSections,
  TestViewHost,
  type HostAction,
  type ViewComponent,
} from "@miragon/pulse-widget-shell/widgets"
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
vi.mock("./failure-dashboard/summary-kpi.js", () => ({
  FailureSummaryKpi: widget("FailureSummaryKpi"),
}))
vi.mock("./failure-dashboard/error-patterns-table.js", () => ({
  ErrorPatternsTable: widget("ErrorPatternsTable"),
}))
vi.mock("./failure-dashboard/failure-rate-table.js", () => ({
  FailureRateTable: widget("FailureRateTable"),
}))
vi.mock("./cluster-compare.js", () => ({ ClusterCompareWidget: widget("ClusterCompareWidget") }))
vi.mock("./version-compare.js", () => ({ VersionCompareWidget: widget("VersionCompareWidget") }))
vi.mock("./engine-compare.js", () => ({ EngineCompareWidget: widget("EngineCompareWidget") }))
vi.mock("./engine-landscape.js", () => ({ EngineLandscapeWidget: widget("EngineLandscapeWidget") }))
vi.mock("./bpmn-heatmap.js", () => ({ AnalyticsBpmnHeatmap: widget("AnalyticsBpmnHeatmap") }))
vi.mock("./settings-section.js", () => ({
  AnalyticsSettingsWidget: widget("AnalyticsSettingsWidget"),
}))
vi.mock("./model-descriptions.js", () => {
  const describe = (name: string) => (data: unknown) => `${name}(${JSON.stringify(data)})`
  return Object.fromEntries(
    [
      "describeExecutionSummary",
      "describeExecutionPerformance",
      "describeDefinitionBreakdown",
      "describeActivityBottlenecks",
      "describeFailureSummary",
      "describeErrorPatterns",
      "describeFailureRates",
      "describeClusterCompare",
      "describeVersionCompare",
      "describeEngineCompare",
      "describeEngineLandscape",
      "describeBpmnHeatmap",
    ].map((name) => [name, describe(name)]),
  )
})

afterEach(() => {
  cleanup()
})

/** Every view-bound tool the plugin registers. */
function viewTools(): string[] {
  const register = vi.fn()
  createPlugin({ url: "http://prometheus.example", engineIds: ["prod-a"] }).register({
    tool: register,
    prompt: vi.fn(),
  } as unknown as MCPServer)
  return register.mock.calls
    .map(([definition]) => (definition as { name: string }).name)
    .filter((name) => name.startsWith("analytics_show_"))
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
      [
        "describeExecutionSummary",
        "describeExecutionPerformance",
        "describeDefinitionBreakdown",
        "describeActivityBottlenecks",
      ],
    ],
    [
      "analytics_show_failure_dashboard",
      ["FailureSummaryKpi", "ErrorPatternsTable", "FailureRateTable"],
      ["describeFailureSummary", "describeErrorPatterns", "describeFailureRates"],
    ],
    ["analytics_show_cluster_compare", ["ClusterCompareWidget"], ["describeClusterCompare"]],
    ["analytics_show_version_compare", ["VersionCompareWidget"], ["describeVersionCompare"]],
    ["analytics_show_engine_compare", ["EngineCompareWidget"], ["describeEngineCompare"]],
    ["analytics_show_engine_landscape", ["EngineLandscapeWidget"], ["describeEngineLandscape"]],
    ["analytics_show_bpmn_heatmap", ["AnalyticsBpmnHeatmap"], ["describeBpmnHeatmap"]],
    ["analytics_show_settings", ["AnalyticsSettingsWidget"], []],
  ])("%s renders %j on its data and tells the model %j", (name, widgets, descriptions) => {
    const rendered = renderView(name)
    expect(rendered.widgets).toEqual(widgets.map((w) => [w, { data: DATA }]))
    expect([...rendered.contexts].sort()).toEqual(descriptions.map(described).sort())
  })
})

describe("analyticsHostWidgets", () => {
  it("offers the settings section and the fleet's landscape by raw id", () => {
    expect(Object.keys(analyticsHostWidgets)).toEqual([
      "analytics:settings",
      "analytics:engine-landscape",
    ])
    expect(settingsSections(analyticsHostWidgets).map(([id]) => id)).toEqual(["analytics:settings"])
  })

  it("renders the settings section self-fetching", () => {
    const actions: HostAction[] = []
    render(
      <TestViewHost onHostAction={(action) => actions.push(action)}>
        {createElement(analyticsHostWidgets["analytics:settings"])}
      </TestViewHost>,
    )
    expect(screen.getByText("{}")).toBeTruthy()
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
