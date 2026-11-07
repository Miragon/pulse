import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeToolResult, type ToolResult } from "@miragon/pulse-widget-shell/server"
import {
  recordingModuleServer,
  type RecordingModuleServer,
} from "@miragon/pulse-widget-shell/testing"
import type { PrometheusClient, PromSample } from "@miragon/pulse-analytics-client"
import {
  createEngineScope,
  NO_ENGINE_SCOPE_MESSAGE,
  type AnalyticsEngineScope,
} from "./engine-ids.js"
import { analyticsModule } from "./module.js"
import { registerTools } from "./tools/index.js"
import { registerWidgetTools } from "./widget-tools.js"

afterEach(() => {
  vi.restoreAllMocks()
})

// #336 / N138: a shared Prometheus (Thanos, Mimir) holds other teams' engines too.

describe("createEngineScope", () => {
  const scope = createEngineScope(["prod-a", " prod-b ", "prod-a", ""])

  it("normalizes the configured ids (trimmed, deduplicated, no blanks)", () => {
    expect(scope.ids).toEqual(["prod-a", "prod-b"])
  })

  it("resolves an omitted engine to the whole configured fleet", () => {
    expect(scope.resolve(undefined)).toEqual(["prod-a", "prod-b"])
    expect(scope.resolve([])).toEqual(["prod-a", "prod-b"])
    expect(scope.resolve("")).toEqual(["prod-a", "prod-b"])
  })

  it("passes configured ids through and refuses every other one, naming the valid ids", () => {
    expect(scope.resolve("prod-b")).toEqual(["prod-b"])
    expect(scope.resolve(["prod-b", "prod-b", "prod-a"])).toEqual(["prod-b", "prod-a"])
    expect(() => scope.resolve(["prod-a", "tenant-x"])).toThrow(
      'Unknown engine "tenant-x" in engine — analytics covers only this server\'s configured engines: prod-a, prod-b.',
    )
    expect(() => scope.require("tenant-x", "engineB")).toThrow(/"tenant-x" in engineB/)
  })

  it("knows when a resolved scope is the whole fleet", () => {
    expect(scope.coversFleet(["prod-b", "prod-a"])).toBe(true)
    expect(scope.coversFleet(["prod-a"])).toBe(false)
  })

  it("is fail-closed without configured ids: nothing resolves, not even the fleet", () => {
    const none = createEngineScope(undefined)
    expect(() => none.resolve(undefined)).toThrow(NO_ENGINE_SCOPE_MESSAGE)
    expect(() => none.require("prod-a", "engineA")).toThrow(NO_ENGINE_SCOPE_MESSAGE)
    expect(none.coversFleet([])).toBe(false)
  })
})

type ToolCallback = (
  args: Record<string, unknown>,
) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

/** Each recorded tool's callback, called the way the SDK calls it. */
const callsOf = (recording: RecordingModuleServer): Map<string, ToolCallback> =>
  new Map([...recording.tools].map(([name, tool]) => [name, (args) => tool.call(args)]))

function toolsOver(ch: PrometheusClient, engineScope: AnalyticsEngineScope) {
  const recording = recordingModuleServer()
  registerTools(recording.server, ch, engineScope)
  registerWidgetTools(recording.server, ch, { engineScope })
  return callsOf(recording)
}

function recordingClient(answer: (q: string) => PromSample[] = () => []) {
  const sent: string[] = []
  const ch: PrometheusClient = {
    instant: (q) => {
      sent.push(q)
      return Promise.resolve(answer(q))
    },
  }
  return { ch, sent }
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

/**
 * Total over the registered surface, so a new tool must prove its engine scoping here. Handlers
 * called directly get no schema defaults: the periods and comparison floors are passed.
 */
const ARGS: Record<string, Record<string, unknown>> = {
  analytics_engine_health: {},
  analytics_show_dashboard: { period: "7d" },
  analytics_show_period_compare: {
    periodAFrom: daysAgo(6),
    periodATo: daysAgo(4),
    periodBFrom: daysAgo(3),
    periodBTo: daysAgo(1),
    activityId: "Task_check",
    minBucketSize: 10,
  },
  analytics_show_version_compare: {
    processDefinitionKey: "order",
    versionA: 1,
    versionB: 2,
    windowDays: 7,
    minBucketSize: 10,
  },
  analytics_show_engine_compare: {
    processDefinitionKey: "order",
    engineA: "prod-a",
    engineB: "prod-b",
    windowDays: 7,
    minBucketSize: 10,
  },
  analytics_show_engine_landscape: {},
  analytics_engine_landscape_data: {},
  analytics_show_bpmn_heatmap: { processDefinitionKey: "order", period: "7d" },
  analytics_bpmn_heatmap_data: { processDefinitionKey: "order", period: "7d" },
}

const PAIRWISE = new Set(["analytics_show_engine_compare"])

/** The heatmap's diagram comes from the engine. */
const READS_NO_PROMETHEUS = new Set(["analytics_bpmn_xml_data"])

/** `""` = an engine-less series. */
function engineIdsMatched(promql: string): string[][] {
  return [...promql.matchAll(/engine_id(=~?)"([^"]*)"/g)].map((m) =>
    m[1] === "=~" ? m[2].split("|") : [m[2]],
  )
}

async function call(tool: ToolCallback, args: Record<string, unknown>) {
  try {
    const result = await tool(args)
    return result.isError ? { refused: result.content[0]?.text ?? "" } : { refused: null }
  } catch (error) {
    return { refused: (error as Error).message }
  }
}

describe("every engine-reading tool is scoped to the configured engines (N138)", () => {
  const scope = createEngineScope(["prod-a", "prod-b"])

  it("names every Prometheus-reading tool the module registers", () => {
    const { ch } = recordingClient()
    const prometheusReading = [...toolsOver(ch, scope).keys()].filter(
      (name) => !READS_NO_PROMETHEUS.has(name),
    )
    expect(prometheusReading.sort()).toEqual(Object.keys(ARGS).sort())
  })

  it("reads the heatmap's diagram from the configured engines only", async () => {
    const asked: Array<string | undefined> = []
    const recording = recordingModuleServer()
    registerWidgetTools(recording.server, recordingClient().ch, {
      engineScope: scope,
      fetchBpmnXml: (_key, engine) => {
        asked.push(engine)
        return Promise.resolve(null)
      },
    })
    const feed = callsOf(recording).get("analytics_bpmn_xml_data")!
    expect((await call(feed, { processDefinitionKey: "order" })).refused).toBeNull()
    expect(asked).toEqual(["prod-a", "prod-b"])
    asked.length = 0
    const { refused } = await call(feed, { processDefinitionKey: "order", engine: "tenant-x" })
    expect(refused).toMatch(/tenant-x/)
    expect(asked).toEqual([])
  })

  it.each(Object.entries(ARGS))(
    "%s with engine omitted reads exactly the configured fleet",
    async (name, args) => {
      const { ch, sent } = recordingClient()
      const { refused } = await call(toolsOver(ch, scope).get(name)!, args)

      expect(refused).toBeNull()
      expect(sent.length).toBeGreaterThan(0)
      for (const promql of sent) {
        const matchers = engineIdsMatched(promql)
        expect({ promql, matchers: matchers.length > 0 }).toEqual({ promql, matchers: true })
        // engine_id="" admits the module's engine-less pipeline alerts.
        for (const id of matchers.flat()) expect(["prod-a", "prod-b", ""]).toContain(id)
      }
      if (!PAIRWISE.has(name)) {
        expect(sent.some((q) => q.includes('engine_id=~"prod-a|prod-b"'))).toBe(true)
      }
    },
  )

  it.each(Object.entries(ARGS).filter(([name]) => !PAIRWISE.has(name)))(
    "%s refuses an engine this server is not configured for, before any query",
    async (name, args) => {
      const { ch, sent } = recordingClient()
      const { refused } = await call(toolsOver(ch, scope).get(name)!, {
        ...args,
        engine: "tenant-x",
      })
      expect(refused).toContain('Unknown engine "tenant-x"')
      expect(sent).toEqual([])
    },
  )

  it.each(Object.entries(ARGS))(
    "%s refuses (and reads nothing) while no engine is configured (fail-closed)",
    async (name, args) => {
      const { ch, sent } = recordingClient()
      const { refused } = await call(toolsOver(ch, createEngineScope([])).get(name)!, args)
      expect(refused).toBe(NO_ENGINE_SCOPE_MESSAGE)
      expect(sent).toEqual([])
    },
  )
})

describe("the BPMN heatmap names the engines its heat adds up (K33)", () => {
  const scope = createEngineScope(["prod-a", "prod-b"])
  type Payload = { engines?: unknown }
  // A view carries it as its structuredContent; a feed answers in JSON text.
  const payloadOf = (result: unknown): Payload => decodeToolResult<Payload>(result as ToolResult)

  it.each(["analytics_show_bpmn_heatmap", "analytics_bpmn_heatmap_data"])(
    "%s echoes the resolved engines in its payload",
    async (name) => {
      const tool = toolsOver(recordingClient().ch, scope).get(name)!
      const fleet = await tool({ processDefinitionKey: "order", period: "7d" })
      const one = await tool({ processDefinitionKey: "order", period: "7d", engine: "prod-b" })

      expect(payloadOf(fleet).engines).toEqual(["prod-a", "prod-b"])
      expect(payloadOf(one).engines).toEqual(["prod-b"])
    },
  )
})

describe("analyticsModule engine scope wiring", () => {
  /** The booted module's fleet, as its refusal of an unknown engine names it (before any query). */
  async function fleetOf(config: Record<string, unknown>, shared: { engineIds?: string[] }) {
    const recording = recordingModuleServer()
    analyticsModule
      .createPlugin({ url: "http://prometheus.invalid", ...config }, shared)
      .register(recording.server)
    const { refused } = await call(callsOf(recording).get("analytics_engine_health")!, {
      engine: "not-configured",
    })
    if (refused === NO_ENGINE_SCOPE_MESSAGE) return []
    return /configured engines: (.*)\.$/.exec(refused ?? "")?.[1].split(", ")
  }

  it("takes the engines the composition root injects (the engine module's configured ones)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await fleetOf({}, { engineIds: ["prod-a", "prod-b"] })).toEqual(["prod-a", "prod-b"])
    expect(warn).not.toHaveBeenCalled()
  })

  it("falls back to ANALYTICS_ENGINE_IDS for a standalone analytics boot", async () => {
    const config = analyticsModule.configFromEnv({ ANALYTICS_ENGINE_IDS: " prod-a , prod-b ," })
    expect(await fleetOf(config, {})).toEqual(["prod-a", "prod-b"])
  })

  it("ignores ANALYTICS_ENGINE_IDS (saying so) when the root injects its engines", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const config = analyticsModule.configFromEnv({ ANALYTICS_ENGINE_IDS: "tenant-x" })
    expect(await fleetOf(config, { engineIds: ["prod-a"] })).toEqual(["prod-a"])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ANALYTICS_ENGINE_IDS is ignored"))
  })

  it("boots fail-closed, with a warning, when neither names an engine", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await fleetOf({}, {})).toEqual([])
    expect(warn).toHaveBeenCalledWith(`[analytics] ${NO_ENGINE_SCOPE_MESSAGE}`)
  })

  it("lists ANALYTICS_ENGINE_IDS as a known env var (typo warner)", () => {
    expect(analyticsModule.knownEnvVars).toContain("ANALYTICS_ENGINE_IDS")
  })
})
