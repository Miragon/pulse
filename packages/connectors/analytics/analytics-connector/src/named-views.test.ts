import { describe, expect, it, vi } from "vitest"
import type {
  AnalyticsDashboardData,
  EngineLandscapeResult,
  FailureDashboardData,
} from "@miragon/pulse-analytics-client"
import { namedDashboard, namedFailureDashboard, namedLandscape } from "./named-views.js"
import { createNameLookup, type NameLookup } from "./bpmn-name-lookup.js"
import { elementNameOf, processNameOf } from "./bpmn-names.js"

/**
 * Every view asks for the names of exactly the ids it lists, no more, by
 * priority, on the engines its rows come from.
 */
describe("named views", () => {
  const lookup = () => vi.fn<NameLookup>(() => Promise.resolve({}))

  it("the dashboard: its scope, the elements of its activities, then its definitions", async () => {
    const namesFor = lookup()
    const data = {
      processDefinitionKey: "order",
      engines: ["prod-b", "prod-a", "prod-c"],
      reportingEngines: ["prod-a", "prod-b"],
      definitionBreakdown: [{ processDefinitionKey: "order" }, { processDefinitionKey: "refund" }],
      activityBreakdown: [
        { processDefinitionKey: "order", activityId: "Task_A" },
        { processDefinitionKey: "order", activityId: "Task_B" },
      ],
    } as unknown as AnalyticsDashboardData
    const named = await namedDashboard(data, namesFor)
    expect(named.names).toEqual({})
    const [keys, request] = namesFor.mock.calls[0]
    expect([...keys]).toEqual(["order", "order", "order", "order", "refund"])
    expect(request?.elementIds).toEqual({ order: ["Task_A", "Task_B"], refund: [] })
    // The reporting engines, in the scope's (configuration) order; a silent one has no rows.
    expect(request?.engines).toEqual(["prod-b", "prod-a"])
  })

  it("the dashboard reads on its whole scope when the payload does not say which engines report", async () => {
    const namesFor = lookup()
    await namedDashboard(
      {
        processDefinitionKey: null,
        engines: ["prod-a", "prod-b"],
        definitionBreakdown: [],
        activityBreakdown: [],
      } as unknown as AnalyticsDashboardData,
      namesFor,
    )
    expect(namesFor.mock.calls[0][1]?.engines).toEqual(["prod-a", "prod-b"])
  })

  it("names a process key such as constructor like any other", async () => {
    const namesFor = lookup()
    await namedDashboard(
      {
        processDefinitionKey: null,
        engines: null,
        definitionBreakdown: [{ processDefinitionKey: "constructor" }],
        activityBreakdown: [{ processDefinitionKey: "constructor", activityId: "Task_A" }],
      } as unknown as AnalyticsDashboardData,
      namesFor,
    )
    expect(namesFor.mock.calls[0][1]?.elementIds).toEqual({ constructor: ["Task_A"] })
    expect(namesFor.mock.calls[0][1]?.engines).toBeNull()
  })

  // The lookup reads at most 40 models per view: a big fleet must not lose its bottleneck names to
  // the long tail of the breakdown.
  it("keeps the activities' names when the fleet has more than 40 definitions", async () => {
    const fetchBpmnXml = vi.fn((key: string) =>
      Promise.resolve(
        `<process id="${key}" name="Process ${key}"><userTask id="Task_Slow" name="Review"/></process>`,
      ),
    )
    const definitions = Array.from({ length: 45 }, (_, i) => ({ processDefinitionKey: `p${i}` }))
    const data = {
      processDefinitionKey: null,
      engines: ["prod-a"],
      reportingEngines: ["prod-a"],
      definitionBreakdown: definitions,
      // A long-running, low-volume process: the last of the breakdown.
      activityBreakdown: [{ processDefinitionKey: "p44", activityId: "Task_Slow" }],
    } as unknown as AnalyticsDashboardData
    const { names } = await namedDashboard(data, createNameLookup(fetchBpmnXml))
    expect(elementNameOf(names, "p44", "Task_Slow")).toBe("Review")
    expect(processNameOf(names, "p44")).toBe("Process p44")
    expect(fetchBpmnXml).toHaveBeenCalledTimes(40)
    // The cap falls on the end of the breakdown instead.
    expect(processNameOf(names, "p0")).toBe("Process p0")
    expect(processNameOf(names, "p40")).toBeNull()
  })

  it("the failure dashboard: process names only, its most affected first, on its engines", async () => {
    const failures = lookup()
    await namedFailureDashboard(
      {
        engines: ["prod-a", "prod-b"],
        errorPatterns: [{ processDefinitionKey: "a" }],
        processBreakdown: [{ processDefinitionKey: "b" }],
        mostAffectedProcess: "b",
      } as unknown as FailureDashboardData,
      failures,
    )
    expect([...failures.mock.calls[0][0]]).toEqual(["b", "a", "b"])
    expect(failures.mock.calls[0][1]).toEqual({
      elementIds: { a: [], b: [] },
      engines: ["prod-a", "prod-b"],
    })

    const none = lookup()
    await namedFailureDashboard(
      {
        engines: ["prod-a"],
        errorPatterns: [],
        processBreakdown: [],
        mostAffectedProcess: null,
      } as unknown as FailureDashboardData,
      none,
    )
    expect([...none.mock.calls[0][0]]).toEqual([])
  })

  it("the landscape: each process read on the engines it runs on", async () => {
    const landscape = lookup()
    await namedLandscape(
      {
        processes: [
          { processDefinitionKey: "c", engineIds: ["prod-b", "prod-c"] },
          { processDefinitionKey: "d", engineIds: ["prod-a"] },
        ],
      } as unknown as EngineLandscapeResult,
      landscape,
    )
    expect(landscape.mock.calls[0][1]).toEqual({
      elementIds: { c: [], d: [] },
      enginesByKey: { c: ["prod-b", "prod-c"], d: ["prod-a"] },
    })
  })
})
