import { describe, expect, it } from "vitest"
import type {
  EngineLandscapeResult,
  PrometheusClient,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"
import { createEngineScope } from "../engine-ids.js"
import { registerComparisonWidgetTools } from "./comparisons.js"
import { recordedTools, type Handler, type ToolResult } from "./recorded-tools.test-support.js"

const engineScope = createEngineScope(["prod-a", "prod-b"])

function handlers(ch: PrometheusClient): Map<string, Handler> {
  const tools = recordedTools((server) =>
    registerComparisonWidgetTools({
      server,
      ch,
      engineScope,
      namesFor: (keys) =>
        Promise.resolve(
          Object.fromEntries([...keys].map((key) => [key, { name: `Name ${key}`, elements: {} }])),
        ),
    }),
  )
  return new Map([...tools].map(([name, { handler }]) => [name, handler]))
}

const dataOf = <T>(result: ToolResult) => result.structuredContent as T
const modelOf = <T>(result: ToolResult) => JSON.parse(result.content[0].text) as T

/** Every query answers 20, so instance counts and durations are equal across versions. */
const ch: PrometheusClient = { instant: () => Promise.resolve([{ metric: {}, value: 20 }]) }

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

describe("analytics_show_version_compare", () => {
  it("returns the per-version incident rates to the model as compact JSON (issue 337)", async () => {
    const show = handlers(ch).get("analytics_show_version_compare")!
    const result = await show({
      processDefinitionKey: "order",
      versionA: 1,
      versionB: 2,
      windowDays: 14,
    })

    const text = result.content[0].text
    expect(text).not.toContain("\n")
    const model = modelOf<VersionCompareResult>(result)
    expect(model.kpis.map((k) => k.incidentRatePct)).toEqual([100, 100])
    expect(model.delta.incidentRateDeltaPp).toBe(0)
    expect(dataOf<VersionCompareResult>(result).kpis.map((k) => k.incidentRatePct)).toEqual([
      100, 100,
    ])
  })

  it("names the engines a fleet comparison aggregates (K33)", async () => {
    const show = handlers(ch).get("analytics_show_version_compare")!
    const result = await show({
      processDefinitionKey: "order",
      versionA: 1,
      versionB: 2,
      windowDays: 14,
    })
    expect(modelOf<VersionCompareResult>(result).engines).toEqual(["prod-a", "prod-b"])
    expect(dataOf<VersionCompareResult>(result).engines).toEqual(["prod-a", "prod-b"])
  })
})

describe("analytics_show_engine_compare: engine scope (N138)", () => {
  it("refuses an engine outside the configured ones", async () => {
    const result = await handlers(ch).get("analytics_show_engine_compare")!({
      processDefinitionKey: "order",
      engineA: "prod-a",
      engineB: "tenant-x",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown engine "tenant-x" in engineB')
  })
})

describe("the model reads what the view shows", () => {
  const ORDER = { process_definition_key: "order", engine_id: "prod-a" }
  const landscapeClient: PrometheusClient = {
    instant: (q) =>
      Promise.resolve(
        q.includes("by (engine_id, process_definition_key)")
          ? [{ metric: ORDER, value: 3 }]
          : [{ metric: { engine_id: "prod-a" }, value: 1 }],
      ),
  }
  // Handlers called directly get no schema defaults: pass the windows and floors.
  const CALLS: Array<[string, Record<string, unknown>]> = [
    [
      "analytics_show_period_compare",
      {
        periodAFrom: daysAgo(4),
        periodATo: daysAgo(2),
        periodBFrom: daysAgo(2),
        periodBTo: daysAgo(1),
        minBucketSize: 10,
      },
    ],
    [
      "analytics_show_version_compare",
      { processDefinitionKey: "o", versionA: 1, versionB: 2, windowDays: 14, minBucketSize: 10 },
    ],
    [
      "analytics_show_engine_compare",
      {
        processDefinitionKey: "o",
        engineA: "prod-a",
        engineB: "prod-b",
        windowDays: 14,
        minBucketSize: 10,
      },
    ],
  ]

  it.each(CALLS)(
    "%s returns the same result in content and structuredContent",
    async (name, args) => {
      const result = await handlers(ch).get(name)!(args)
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent))
    },
  )

  it("returns the landscape's figures without the names the view shows", async () => {
    const result = await handlers(landscapeClient).get("analytics_show_engine_landscape")!({})
    const { names, ...figures } = dataOf<Record<string, unknown>>(result)
    expect(names).toEqual({ order: { name: "Name order", elements: {} } })
    expect(result.content[0].text).toBe(JSON.stringify(figures))
    expect(modelOf<EngineLandscapeResult>(result).processes[0]).toMatchObject({
      processDefinitionKey: "order",
      runningTotal: 3,
    })
    expect(result.content[0].text).not.toContain("Name order")
  })
})

describe("no server titles (U3): the widget heading names the view in the host's language", () => {
  const titledHandlers = () => handlers(ch)
  const CALLS: Array<[string, Record<string, unknown>]> = [
    // Handlers called directly get no schema defaults: pass the window.
    [
      "analytics_show_period_compare",
      {
        periodAFrom: daysAgo(4),
        periodATo: daysAgo(2),
        periodBFrom: daysAgo(2),
        periodBTo: daysAgo(1),
        minBucketSize: 10,
      },
    ],
    [
      "analytics_show_version_compare",
      { processDefinitionKey: "o", versionA: 1, versionB: 2, windowDays: 14 },
    ],
    [
      "analytics_show_engine_compare",
      { processDefinitionKey: "o", engineA: "prod-a", engineB: "prod-b", windowDays: 14 },
    ],
    ["analytics_show_engine_landscape", {}],
  ]

  it("hands each comparison and the landscape its data only", async () => {
    const tools = titledHandlers()
    for (const [name, args] of CALLS) {
      const { structuredContent } = await tools.get(name)!(args)
      expect(Object.keys(structuredContent)).not.toContain("title")
      expect(Object.keys(structuredContent)).not.toContain("layout")
    }
  })
})
