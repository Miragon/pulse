import { describe, expect, it } from "vitest"
import { decodeToolResult, type ToolResult } from "@miragon/pulse-widget-shell/server"
import type { MCPServer } from "mcp-use"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { registerWidgetTools } from "./widget-tools.js"
import { createEngineScope } from "./engine-ids.js"
import type { FetchBpmnXml, NameRequest } from "./bpmn-name-lookup.js"

/** Feeds answer in JSON text only. */
const feedData = <T = Record<string, unknown>>(result: unknown): T =>
  decodeToolResult<T>(result as ToolResult)

/** A show tool's structuredContent IS the view's data. */
type ShowResult = { structuredContent: Record<string, unknown> }
type Handler = (args: Record<string, unknown>, ctx: unknown) => Promise<ShowResult>

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

describe("no server titles (U3) and the heatmap's as-of stamp (U7)", () => {
  const CTX = { auth: { user: { id: "user-1" } } }
  function viewHandlers(): Map<string, Handler> {
    const byName = new Map<string, Handler>()
    const server = {
      tool: (definition: { name: string }, handler: Handler) => {
        byName.set(definition.name, handler)
      },
    } as unknown as MCPServer
    registerWidgetTools(server, recordingClient().client, {
      engineScope: createEngineScope(["prod-a"]),
    })
    return byName
  }
  // Handlers called directly get no schema defaults: pass the period.
  const SHOWS: Array<[string, Record<string, unknown>]> = [
    ["analytics_show_dashboard", { period: "7d" }],
    ["analytics_show_bpmn_heatmap", { processDefinitionKey: "order", period: "7d" }],
  ]
  it("hands the view its data only: the widget heading names it in the host's language", async () => {
    const tools = viewHandlers()
    for (const [name, args] of SHOWS) {
      const { structuredContent } = await tools.get(name)!(args, CTX)
      expect(Object.keys(structuredContent)).not.toContain("title")
      expect(Object.keys(structuredContent)).not.toContain("layout")
    }
  })

  it("stamps the heatmap with the time its values were read, in the view and the feed", async () => {
    const tools = viewHandlers()
    const args = { processDefinitionKey: "order", period: "7d" }
    const show = await tools.get("analytics_show_bpmn_heatmap")!(args, CTX)
    const feed = await tools.get("analytics_bpmn_heatmap_data")!(args, CTX)
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    expect(show.structuredContent.asOf).toMatch(iso)
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
    const args = { processDefinitionKey: "order", period: "7d" }
    const show = await byName.get("analytics_show_bpmn_heatmap")!(args, {})
    const heat = feedData<Diagram>(await byName.get("analytics_bpmn_heatmap_data")!(args, {}))
    const diagram = feedData<Diagram>(await byName.get("analytics_bpmn_xml_data")!(args, {}))
    const fields = ({ bpmnXml, bpmnMissing }: Diagram) => ({ bpmnXml, bpmnMissing })
    return {
      show: fields(show.structuredContent),
      heat: fields(heat),
      diagram: fields(diagram),
    }
  }

  it("names the missing engine module only when no lookup was injected", async () => {
    const { show, heat, diagram } = await payloads()
    expect(show).toEqual({ bpmnXml: undefined, bpmnMissing: "no-engine-module" })
    expect(heat).toEqual({ bpmnXml: undefined, bpmnMissing: undefined })
    expect(diagram).toEqual({ bpmnXml: null, bpmnMissing: "no-engine-module" })
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
      // The engine-state presence probe: prod-a reports.
      if (query.includes("engine_jobs_executable")) {
        return Promise.resolve([{ metric: { engine_id: "prod-a" }, value: 1 }])
      }
      if (query.includes("by (process_definition_key, activity_id, activity_type)")) {
        return Promise.resolve([
          { metric: { ...ORDER, activity_id: "Task_A", activity_type: "userTask" }, value: 2 },
        ])
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
    registerWidgetTools(server, client, {
      engineScope: createEngineScope(["prod-a"]),
      namesFor: (keys, request) => {
        calls.push([[...keys], request])
        return Promise.resolve(NAMES)
      },
    })
    const ctx = { auth: { user: { id: "user-1" } } }
    // Handlers called directly get no schema defaults: pass the period.
    const result = await byName.get(name)!({ period: "7d" }, ctx)
    return { content: feedData(result), result, calls }
  }

  it.each([
    "analytics_show_dashboard",
    "analytics_show_engine_landscape",
    "analytics_engine_landscape_data",
  ])("%s carries the names", async (name) => {
    const { content, calls } = await run(name)
    expect(JSON.stringify(content)).toContain('"names":{"order":{"name":"Order fulfillment"')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain("order")
  })

  it("asks for the elements of the activity breakdown only", async () => {
    const { calls } = await run("analytics_show_dashboard")
    expect(calls[0][1]?.elementIds).toEqual({ order: ["Task_A"] })
  })

  // A process that runs only on a later engine is named too.
  it("reads the models on the engines the rows come from", async () => {
    const dashboard = await run("analytics_show_dashboard")
    expect(dashboard.calls[0][1]?.engines).toEqual(["prod-a"])
    const landscape = await run("analytics_engine_landscape_data")
    expect(landscape.calls[0][1]?.enginesByKey).toEqual({ order: ["prod-a"] })
  })

  it("returns the dashboard's figures to the model as compact JSON, without the names", async () => {
    const { result } = await run("analytics_show_dashboard")
    const text = (result as unknown as { content: Array<{ text: string }> }).content[0].text
    const { names, ...figures } = result.structuredContent
    expect(names).toEqual(NAMES)
    // No pretty printing: one line, the figures exactly as the view gets them.
    expect(text).not.toContain("\n")
    expect(JSON.parse(text)).toEqual(figures)
    expect(text).toBe(JSON.stringify(figures))
    expect(text).not.toContain("Order fulfillment")
  })

  it("judges the dashboard's rate against the comparison floor, the schemas' default 10", async () => {
    const { content } = await run("analytics_show_dashboard")
    // 4 starts in each window, below the floor 10: the rate change is not judged.
    expect(content.previous).toMatchObject({ startedCount: 4, suppressed: true })
  })
})
