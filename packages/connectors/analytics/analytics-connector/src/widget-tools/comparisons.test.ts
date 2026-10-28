import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import type {
  ClusterCompareResult,
  PrometheusClient,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"
import { createEngineScope } from "../engine-ids.js"
import type { ProfileSource } from "../server-locale.js"
import { registerComparisonWidgetTools } from "./comparisons.js"

type ToolResult = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent: { context: { stepData: { result: { data: unknown } } } }
}
type Handler = (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult>

const engineScope = createEngineScope(["prod-a", "prod-b"])

function handlers(ch: PrometheusClient): Map<string, Handler> {
  const byName = new Map<string, Handler>()
  const server = {
    tool: (definition: { name: string }, handler: Handler) => {
      byName.set(definition.name, handler)
    },
  } as unknown as MCPServer
  registerComparisonWidgetTools({ server, ch, engineScope })
  return byName
}

const dataOf = <T>(result: ToolResult) => result.structuredContent.context.stepData.result.data as T

/** Every query answers 20, so instance counts and durations are equal across versions. */
const ch: PrometheusClient = { instant: () => Promise.resolve([{ metric: {}, value: 20 }]) }

describe("analytics_show_version_compare", () => {
  it("summarises the measured incident-rate delta per version (#337)", async () => {
    const show = handlers(ch).get("analytics_show_version_compare")!
    const result = await show(
      { processDefinitionKey: "order", versionA: 1, versionB: 2, windowDays: 14 },
      {},
    )

    expect(result.content[0].text).toContain("incident rate 0pp")
    const data = dataOf<VersionCompareResult>(result)
    expect(data.kpis.map((k) => k.incident_rate_pct)).toEqual([100, 100])
  })

  it("names the engines a fleet comparison aggregates (K33)", async () => {
    const show = handlers(ch).get("analytics_show_version_compare")!
    const result = await show(
      { processDefinitionKey: "order", versionA: 1, versionB: 2, windowDays: 14 },
      {},
    )
    expect(result.content[0].text).toContain(
      'across all 2 configured engines ("prod-a", "prod-b"), aggregated',
    )
    expect(dataOf<VersionCompareResult>(result).engines).toEqual(["prod-a", "prod-b"])
  })
})

describe("analytics_show_cluster_compare — clamped windows (N79)", () => {
  const NOW = Date.parse("2026-10-09T12:00:00Z")
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it("measures a recent deployment's post window up to now and says so", async () => {
    const sent: string[] = []
    const recording: PrometheusClient = {
      instant: (q) => {
        sent.push(q)
        return Promise.resolve([{ metric: {}, value: 20 }])
      },
    }
    const deployedTwoHoursAgo = new Date(NOW - 2 * 3_600_000).toISOString()
    const result = await handlers(recording).get("analytics_show_cluster_compare")!(
      { deploymentTimestamp: deployedTwoHoursAgo, windowBeforeDays: 7, windowAfterDays: 7 },
      {},
    )

    // No `@` anchor beyond now — the post window is 2 h, not 7 d.
    const anchors = sent.flatMap((q) => [...q.matchAll(/@ (\d+)/g)].map((m) => Number(m[1])))
    expect(Math.max(...anchors)).toBe(NOW / 1000)
    const data = dataOf<ClusterCompareResult>(result)
    expect(data).toMatchObject({
      partial: true,
      requestedWindowDays: { before: 7, after: 7 },
      windowDays: { before: 7, after: 0.08 },
    })
    expect(result.content[0].text).toContain("measured -7d / +0.08d, partial")
    // 20 starts in 2 h vs 20 in 7 d is a huge rise PER DAY — never a flat 0 %.
    expect(data.delta.started_per_day_delta_pct).toBe(8300)
  })

  it("refuses a deployment in the future instead of comparing an empty window", async () => {
    const result = await handlers(ch).get("analytics_show_cluster_compare")!(
      { deploymentTimestamp: new Date(NOW + 3_600_000).toISOString() },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("deploymentTimestamp lies in the future")
  })
})

describe("analytics_show_engine_compare — engine scope (N138)", () => {
  it("refuses an engine outside the configured ones", async () => {
    const result = await handlers(ch).get("analytics_show_engine_compare")!(
      { processDefinitionKey: "order", engineA: "prod-a", engineB: "tenant-x" },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown engine "tenant-x" in engineB')
  })
})

describe("view titles (U3): the toolbar speaks the caller's language", () => {
  const CTX = { auth: { user: { id: "user-1" } } }
  const titledHandlers = (language: string) => {
    const byName = new Map<string, Handler>()
    const server = {
      tool: (definition: { name: string }, handler: Handler) => {
        byName.set(definition.name, handler)
      },
    } as unknown as MCPServer
    const profileStore: ProfileSource = { get: () => Promise.resolve({ language }) }
    registerComparisonWidgetTools({ server, ch, engineScope, profileStore })
    return byName
  }
  const titleOf = (result: ToolResult) =>
    (result.structuredContent as unknown as { title?: string }).title

  const CALLS: Array<[string, Record<string, unknown>]> = [
    // Handlers called directly get no schema defaults: pass the window.
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
  const titles = async (language: string) => {
    const tools = titledHandlers(language)
    return Promise.all(CALLS.map(([name, args]) => tools.get(name)!(args, CTX).then(titleOf)))
  }

  it("titles each comparison and the landscape in German", async () => {
    expect(await titles("de")).toEqual([
      "Versionsvergleich",
      "Engine-Vergleich",
      "Engine-übergreifende Übersicht",
    ])
  })

  it("and in English, in sentence case", async () => {
    expect(await titles("en")).toEqual([
      "Version comparison",
      "Engine comparison",
      "Cross-engine landscape",
    ])
  })
})
