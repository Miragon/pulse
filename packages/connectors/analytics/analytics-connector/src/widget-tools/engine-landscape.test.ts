import { describe, expect, it } from "vitest"
import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import type {
  EngineLandscapeResult,
  PrometheusClient,
  PromSample,
} from "@miragon/pulse-analytics-client"
import { createEngineScope } from "../engine-ids.js"
import { registerWidgetTools } from "../widget-tools.js"

type ToolResult = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent: Record<string, unknown>
}
type Definition = { name: string; description: string; inputSchema: z.ZodObject }
type Handler = (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult>

const NAME = "analytics_show_engine_landscape"

/** prod-c reports nothing. */
function showLandscape(ch: PrometheusClient): { definition: Definition; handler: Handler } {
  const tools = new Map<string, { definition: Definition; handler: Handler }>()
  const server = {
    tool: (definition: Definition, handler: Handler) => {
      tools.set(definition.name, { definition, handler })
    },
  } as unknown as MCPServer
  registerWidgetTools(server, ch, {
    engineScope: createEngineScope(["prod-a", "prod-b", "prod-c"]),
  })
  return tools.get(NAME)!
}

/** Records every PromQL string and answers with a two-engine landscape. */
function recordingClient(): { client: PrometheusClient; queries: string[] } {
  const queries: string[] = []
  const cell = (engine_id: string, process_definition_key: string, value: number): PromSample => ({
    metric: { engine_id, process_definition_key },
    value,
  })
  return {
    client: {
      instant: (query: string) => {
        queries.push(query)
        if (query.includes("process_definitions_deployed")) {
          return Promise.resolve([cell("prod-a", "order", 1), cell("prod-b", "onboarding", 1)])
        }
        if (query.includes("process_instances_running")) {
          return Promise.resolve([cell("prod-a", "order", 5)])
        }
        return Promise.resolve([])
      },
    },
    queries,
  }
}

/** The model's figures: the content text, as compact JSON. */
const modelResult = (result: ToolResult) =>
  JSON.parse(result.content[0].text) as EngineLandscapeResult

describe("analytics_show_engine_landscape", () => {
  it("builds the inventory matrix and issues one node-folded query per metric", async () => {
    const { client, queries } = recordingClient()

    const shown = await showLandscape(client).handler({}, {})
    const result = modelResult(shown)

    // Engine omitted = the configured fleet: the silent prod-c stays visible.
    expect(result.engines.map((e) => e.engineId)).toEqual(["prod-a", "prod-b", "prod-c"])
    expect(result.engines[0].runningInstances).toBe(5)
    // Each engine runs its own definition: nothing to compare like-for-like.
    expect(result.sharedProcessKeys).toEqual([])
    // The view renders the same figures.
    expect(shown.structuredContent).toMatchObject({
      engines: result.engines,
      sharedProcessKeys: [],
    })
    const sel = '{engine_id=~"prod-a|prod-b|prod-c"}'
    // Every gauge folded over its own labels first: a clustered engine's
    // nodes report the same engine-wide rows.
    const byKey = (gauge: string, labels = "process_definition_key, engine_id") =>
      `sum by (engine_id, process_definition_key)(max by (${labels})(${gauge}${sel}))`
    expect(queries).toEqual([
      byKey("camunda_process_definitions_deployed"),
      byKey("camunda_process_instances_running"),
      byKey("camunda_incidents_open", "process_definition_key, incident_type, engine_id"),
      byKey("camunda_jobs_failed"),
      `max by (engine_id)(camunda_jobs_executable${sel})`,
      `max by (engine_id)(camunda_jobs_suspended${sel})`,
      `max by (engine_id)(camunda_jobs_due_future${sel})`,
      `max by (engine_id)(camunda_external_tasks_open${sel})`,
    ])
  })

  it("applies the engine filter and keeps a non-reporting engine visible", async () => {
    const { client, queries } = recordingClient()

    const result = modelResult(
      await showLandscape(client).handler({ engine: ["prod-a", "prod-c"] }, {}),
    )

    expect(queries.every((q) => q.includes('{engine_id=~"prod-a|prod-c"}'))).toBe(true)
    expect(result.engines.find((e) => e.engineId === "prod-c")).toMatchObject({ reporting: false })
  })

  it("never lists another tenant's engine from a shared Prometheus (N138)", async () => {
    const { client, queries } = recordingClient()

    const result = await showLandscape(client).handler({ engine: ["prod-a", "tenant-x"] }, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Unknown engine "tenant-x"/)
    expect(queries).toEqual([])
  })
})

describe("analytics_show_engine_landscape registration", () => {
  const { definition } = showLandscape(recordingClient().client)

  it("tells the model that counts, not per-engine rates, are the point", () => {
    // Else the model divides counts back into per-engine rates, the confound the view avoids.
    expect(definition.description).toContain("Counts, not rates")
    expect(definition.description).toContain("process mixes")
    expect(definition.description).toContain("sharedProcessKeys")
  })

  it("accepts an engine list or nothing at all", () => {
    const schema = definition.inputSchema
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ engine: ["prod-a", "prod-b"] }).success).toBe(true)
    expect(schema.safeParse({ engine: "prod-a" }).success).toBe(true)
  })
})
