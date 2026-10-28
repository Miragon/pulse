import { describe, expect, it } from "vitest"
import { parseToolResult } from "@miragon/mcp-toolkit-ui"
import type { MCPServer } from "mcp-use"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { registerWidgetTools } from "./widget-tools.js"
import { createEngineScope } from "./engine-ids.js"
import type { ProfileSource } from "./server-locale.js"
import type { FetchBpmnXml, NameRequest } from "./bpmn-name-lookup.js"

/** Feeds answer in JSON text only. */
const feedData = <T = Record<string, unknown>>(result: unknown): T => parseToolResult<T>(result)

type Cell = { widget: string; props?: Record<string, unknown> }
type ShowResult = { structuredContent: { layout: Array<{ row: Cell[] }> } }
type Handler = (args: Record<string, unknown>, ctx: unknown) => Promise<ShowResult>

function handlers(ch: PrometheusClient): Map<string, Handler> {
  const byName = new Map<string, Handler>()
  const server = {
    tool: (definition: { name: string }, handler: Handler) => {
      byName.set(definition.name, handler)
    },
  } as unknown as MCPServer
  registerWidgetTools(server, ch, { engineScope: createEngineScope(["prod-a", "prod-b"]) })
  return byName
}

function recordingClient(): { client: PrometheusClient; queries: string[] } {
  const queries: string[] = []
  return {
    client: {
      instant: (query: string) => {
        queries.push(query)
        return Promise.resolve([])
      },
    },
    queries,
  }
}

const cells = (result: ShowResult) => result.structuredContent.layout.flatMap((r) => r.row)

// Without the scope, the cells' hand-offs would send the model to every engine.
describe("analytics_show_failure_dashboard engine scope", () => {
  it("queries the engine and hands it to every cell", async () => {
    const { client, queries } = recordingClient()
    const show = handlers(client).get("analytics_show_failure_dashboard")!
    const result = await show({ engine: "prod-b" }, {})

    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query).toContain('engine_id="prod-b"')
    // model-descriptions.test.ts pins the `engine` id the hand-offs then carry.
    expect(cells(result)).toEqual([
      { widget: "analytics:failure-summary-kpi", props: { engine: "prod-b" } },
      { widget: "analytics:error-patterns-table", props: { engine: "prod-b" } },
      { widget: "analytics:failure-rate-table", props: { engine: "prod-b" } },
    ])
  })

  // The aggregate is the CONFIGURED fleet (#336), never the whole Prometheus.
  it("reads the configured fleet for the aggregate and leaves the cells unscoped", async () => {
    const { client, queries } = recordingClient()
    const result = await handlers(client).get("analytics_show_failure_dashboard")!({}, {})

    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query).toContain('engine_id=~"prod-a|prod-b"')
    expect(cells(result).every((cell) => cell.props === undefined)).toBe(true)
  })
})

describe("view titles (U3) and the heatmap's as-of stamp (U7)", () => {
  const CTX = { auth: { user: { id: "user-1" } } }
  function localizedHandlers(language: string): Map<string, Handler> {
    const byName = new Map<string, Handler>()
    const server = {
      tool: (definition: { name: string }, handler: Handler) => {
        byName.set(definition.name, handler)
      },
    } as unknown as MCPServer
    const profileStore: ProfileSource = { get: () => Promise.resolve({ language }) }
    registerWidgetTools(server, recordingClient().client, {
      engineScope: createEngineScope(["prod-a"]),
      profileStore,
    })
    return byName
  }
  const SHOWS: Array<[string, Record<string, unknown>]> = [
    ["analytics_show_dashboard", {}],
    ["analytics_show_failure_dashboard", {}],
    ["analytics_show_bpmn_heatmap", { processDefinitionKey: "order" }],
  ]
  const titles = async (language: string) => {
    const tools = localizedHandlers(language)
    const results = await Promise.all(SHOWS.map(([name, args]) => tools.get(name)!(args, CTX)))
    return results.map((r) => (r.structuredContent as unknown as { title?: string }).title)
  }

  it("titles each view in the caller's language, like the widget heading", async () => {
    expect(await titles("de")).toEqual(["Prozessanalyse", "Fehleranalyse", "BPMN-Heatmap"])
    expect(await titles("en")).toEqual(["Process analytics", "Failure analysis", "BPMN heatmap"])
  })

  it("stamps the heatmap with the time its values were read, in the view and the feed", async () => {
    const tools = localizedHandlers("en")
    const args = { processDefinitionKey: "order" }
    const show = (await tools.get("analytics_show_bpmn_heatmap")!(args, CTX)) as unknown as {
      structuredContent: { context: { stepData: { result: { data: { asOf?: string } } } } }
    }
    const feed = await tools.get("analytics_bpmn_heatmap_data")!(args, CTX)
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    expect(show.structuredContent.context.stepData.result.data.asOf).toMatch(iso)
    expect(feedData<{ asOf?: string }>(feed).asOf).toMatch(iso)
  })
})

// The widget words the cause the server knows and never guesses.
describe("the heatmap's missing-diagram cause", () => {
  type Diagram = { bpmnXml?: string | null; bpmnMissing?: string }

  /** The show payload never carries the XML: the model reads it on some hosts. */
  async function payloads(fetchBpmnXml?: FetchBpmnXml, engines = ["prod-a"]) {
    const byName = new Map<string, Handler>()
    const server = {
      tool: (definition: { name: string }, handler: Handler) => {
        byName.set(definition.name, handler)
      },
    } as unknown as MCPServer
    registerWidgetTools(server, recordingClient().client, {
      engineScope: createEngineScope(engines),
      fetchBpmnXml,
    })
    const args = { processDefinitionKey: "order" }
    const show = (await byName.get("analytics_show_bpmn_heatmap")!(args, {})) as unknown as {
      structuredContent: { context: { stepData: { result: { data: Diagram } } } }
    }
    const heat = feedData<Diagram>(await byName.get("analytics_bpmn_heatmap_data")!(args, {}))
    const diagram = feedData<Diagram>(await byName.get("analytics_bpmn_xml_data")!(args, {}))
    const fields = ({ bpmnXml, bpmnMissing }: Diagram) => ({ bpmnXml, bpmnMissing })
    return {
      show: fields(show.structuredContent.context.stepData.result.data),
      heat: fields(heat),
      diagram: fields(diagram),
    }
  }

  it("names the missing camunda7 module only when no lookup was injected", async () => {
    const { show, heat, diagram } = await payloads()
    expect(show).toEqual({ bpmnXml: undefined, bpmnMissing: "no-camunda7" })
    expect(heat).toEqual({ bpmnXml: undefined, bpmnMissing: undefined })
    expect(diagram).toEqual({ bpmnXml: null, bpmnMissing: "no-camunda7" })
  })

  it("says the lookup found nothing when it failed or returned null", async () => {
    const failing: FetchBpmnXml = () => Promise.reject(new Error("ECONNREFUSED"))
    const empty: FetchBpmnXml = () => Promise.resolve(null)
    for (const fetcher of [failing, empty]) {
      const { show, diagram } = await payloads(fetcher)
      expect(show).toEqual({ bpmnXml: undefined, bpmnMissing: "not-loaded" })
      expect(diagram).toEqual({ bpmnXml: null, bpmnMissing: "not-loaded" })
    }
  })

  it("keeps the XML out of the show payload and the heat feed when the diagram is there", async () => {
    const xml = '<?xml version="1.0"?><definitions />'
    const { show, heat, diagram } = await payloads(() => Promise.resolve(xml))
    expect(show).toEqual({ bpmnXml: undefined, bpmnMissing: undefined })
    expect(heat).toEqual({ bpmnXml: undefined, bpmnMissing: undefined })
    expect(diagram).toEqual({ bpmnXml: xml, bpmnMissing: undefined })
  })

  // The process may run on a later engine only.
  it("reads the diagram from the engines of its scope in order", async () => {
    const xml = '<?xml version="1.0"?><definitions />'
    const asked: Array<[string, string | undefined]> = []
    const fetcher: FetchBpmnXml = (key, engine) => {
      asked.push([key, engine])
      if (engine === "prod-a") return Promise.reject(new Error("503"))
      return Promise.resolve(engine === "prod-c" ? xml : null)
    }
    const { diagram } = await payloads(fetcher, ["prod-a", "prod-b", "prod-c"])
    expect(diagram).toEqual({ bpmnXml: xml, bpmnMissing: undefined })
    expect(asked.slice(0, 3)).toEqual([
      ["order", "prod-a"],
      ["order", "prod-b"],
      ["order", "prod-c"],
    ])
  })
})

// U13
describe("the names behind the ids", () => {
  const ORDER = { process_definition_key: "order" }
  const client: PrometheusClient = {
    instant: (query: string) => {
      if (query.includes("by (process_definition_key, activity_id, activity_type)")) {
        return Promise.resolve([
          { metric: { ...ORDER, activity_id: "Task_A", activity_type: "userTask" }, value: 2 },
        ])
      }
      if (query.includes("by (process_definition_key, incident_type)")) {
        return Promise.resolve([{ metric: { ...ORDER, incident_type: "failedJob" }, value: 1 }])
      }
      if (query.includes("by (engine_id, process_definition_key)")) {
        return Promise.resolve([{ metric: { ...ORDER, engine_id: "prod-a" }, value: 1 }])
      }
      if (query.includes("by (process_definition_key)")) {
        return Promise.resolve([{ metric: ORDER, value: 3 }])
      }
      if (query.includes("process_instance_started_total")) {
        return Promise.resolve([{ metric: {}, value: 4 }])
      }
      return Promise.resolve([])
    },
  }
  const NAMES = { order: { name: "Order fulfillment", elements: { Task_A: "Pack" } } }

  async function run(name: string) {
    const byName = new Map<string, Handler>()
    const server = {
      tool: (definition: { name: string }, handler: Handler) => {
        byName.set(definition.name, handler)
      },
    } as unknown as MCPServer
    const calls: Array<[string[], NameRequest | undefined]> = []
    const profileStore: ProfileSource = {
      get: () => Promise.resolve({ modules: { analytics: { minBucketSize: 3 } } }),
    }
    registerWidgetTools(server, client, {
      engineScope: createEngineScope(["prod-a"]),
      profileStore,
      namesFor: (keys, request) => {
        calls.push([[...keys], request])
        return Promise.resolve(NAMES)
      },
    })
    const ctx = { auth: { user: { id: "user-1" } } }
    const result = await byName.get(name)!({}, ctx)
    return { content: feedData(result), calls }
  }

  const payloadOf = (content: Record<string, unknown>) =>
    ((content.context as { stepData?: { result?: { data?: unknown } } } | undefined)?.stepData
      ?.result?.data ?? content) as Record<string, unknown>

  it.each([
    "analytics_show_dashboard",
    "analytics_dashboard_data",
    "analytics_show_failure_dashboard",
    "analytics_failure_dashboard_data",
    "analytics_show_engine_landscape",
    "analytics_engine_landscape_data",
  ])("%s carries the names", async (name) => {
    const { content, calls } = await run(name)
    expect(JSON.stringify(content)).toContain('"names":{"order":{"name":"Order fulfillment"')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain("order")
  })

  it("asks for the elements of the activity breakdown only", async () => {
    const { calls } = await run("analytics_dashboard_data")
    expect(calls[0][1]?.elementIds).toEqual({ order: ["Task_A"] })
    const failures = await run("analytics_failure_dashboard_data")
    expect(failures.calls[0][1]?.elementIds).toEqual({ order: [] })
  })

  // A process that runs only on a later engine is named too.
  it("reads the models on the engines the rows come from", async () => {
    const failures = await run("analytics_failure_dashboard_data")
    expect(failures.calls[0][1]?.engines).toEqual(["prod-a"])
    const landscape = await run("analytics_engine_landscape_data")
    expect(landscape.calls[0][1]?.enginesByKey).toEqual({ order: ["prod-a"] })
  })

  it("judges the dashboard's rate against the caller's saved comparison floor", async () => {
    const { content } = await run("analytics_dashboard_data")
    // 4 starts in each window, the saved floor 3: a change of the rate is judged.
    expect(payloadOf(content).previous).toMatchObject({ totalCount: 4, suppressed: false })
  })
})
