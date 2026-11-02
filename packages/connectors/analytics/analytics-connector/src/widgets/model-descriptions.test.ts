import { describe, expect, it } from "vitest"
import type { AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import { describeBpmnHeatmap } from "./model-descriptions.js"

describe("describeBpmnHeatmap", () => {
  const heatmap = (engines: string[]): AnalyticsBpmnHeatmapData => ({
    processDefinitionKey: "order",
    period: "7d",
    engines,
    frequency: { Task_A: 12, Task_B: 4 },
    durationMs: { Task_A: 1040, Task_B: 9260 },
    asOf: "2026-10-10T12:32:00.000Z",
  })

  it("names the engines whose heat it adds up (K33)", () => {
    const fleet = describeBpmnHeatmap(heatmap(["prod-a", "prod-b"]))
    expect(fleet).toContain(
      'Ids: engine=["prod-a","prod-b"], processDefinitionKey="order", period="7d"',
    )
    expect(fleet).toContain("(aggregated)")
    expect(describeBpmnHeatmap(heatmap(["prod-b"]))).toContain(
      'Ids: engine="prod-b", processDefinitionKey="order", period="7d"',
    )
  })

  it("the hottest and slowest element as facts", () => {
    const text = describeBpmnHeatmap(heatmap(["prod-a"]))
    expect(text).toContain('hottestActivityId="Task_A", hottestExecutions=12')
    expect(text).toContain('slowestActivityId="Task_B", slowestAvgMs=9260')
    expect(text).not.toMatch(/\b(camunda7|analytics)_[a-z0-9_]+/)
  })
})
