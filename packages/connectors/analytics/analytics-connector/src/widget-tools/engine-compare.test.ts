import { describe, expect, it } from "vitest"
import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import {
  increaseIn,
  type EngineCompareResult,
  type PrometheusClient,
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

const NAME = "analytics_show_engine_compare"

function showEngineCompare(ch: PrometheusClient): { definition: Definition; handler: Handler } {
  const tools = new Map<string, { definition: Definition; handler: Handler }>()
  const server = {
    tool: (definition: Definition, handler: Handler) => {
      tools.set(definition.name, { definition, handler })
    },
  } as unknown as MCPServer
  registerWidgetTools(server, ch, { engineScope: createEngineScope(["prod-a", "prod-b"]) })
  return tools.get(NAME)!
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

/** No duplicate incident query without an element (N85). */
function kpiQueries(sel: string, completedSel: string, range: string) {
  const count = (series: string) => increaseIn(series, { range })
  const duration = "engine_process_instance_duration_milliseconds"
  return [
    `sum(${count(`engine_process_instance_started_total${sel}`)})`,
    `sum(${count(`engine_process_instance_ended_total${completedSel}`)})`,
    `sum(${count(`engine_incident_created_total${sel}`)})`,
    `sum(${count(`${duration}_sum${sel}`)}) / sum(${count(`${duration}_count${sel}`)})`,
    `histogram_quantile(0.5, sum by (le)(${count(`${duration}_bucket${sel}`)}))`,
    `histogram_quantile(0.95, sum by (le)(${count(`${duration}_bucket${sel}`)}))`,
  ]
}

const dataOf = (result: ToolResult) => result.structuredContent as unknown as EngineCompareResult

describe("analytics_show_engine_compare PromQL", () => {
  it("partitions every query by engine_id and applies the shared window", async () => {
    const { client, queries } = recordingClient()
    const key = 'process_definition_key="order"'

    await showEngineCompare(client).handler(
      {
        processDefinitionKey: "order",
        engineA: "prod-a",
        engineB: "prod-b",
        windowDays: 14,
        minBucketSize: 10,
      },
      {},
    )

    expect(queries).toEqual([
      ...kpiQueries(
        `{${key},engine_id="prod-a"}`,
        `{${key},state="COMPLETED",engine_id="prod-a"}`,
        "14d",
      ),
      ...kpiQueries(
        `{${key},engine_id="prod-b"}`,
        `{${key},state="COMPLETED",engine_id="prod-b"}`,
        "14d",
      ),
    ])
  })

  it("scopes to processDefinitionKey everywhere and activityId only on the incident query", async () => {
    const { client, queries } = recordingClient()

    await showEngineCompare(client).handler(
      {
        engineA: "prod-a",
        engineB: "prod-b",
        windowDays: 7,
        processDefinitionKey: "order",
        activityId: "Task_check",
        minBucketSize: 1,
      },
      {},
    )

    const key = 'process_definition_key="order"'
    expect(queries).toHaveLength(14)
    expect(queries.every((q) => q.includes(key))).toBe(true)
    const elementScoped = queries.filter((q) => q.includes('activity_id="Task_check"'))
    const incidents = (engine: string) =>
      `sum(${increaseIn(`engine_incident_created_total{${key},activity_id="Task_check",engine_id="${engine}"}`, { range: "7d" })})`
    expect(elementScoped).toEqual([incidents("prod-a"), incidents("prod-b")])
  })

  it("refuses an engine this server is not configured for, before any query (N138)", async () => {
    const { client, queries } = recordingClient()

    const result = await showEngineCompare(client).handler(
      {
        processDefinitionKey: "order",
        engineA: "prod-a",
        engineB: "tenant-x",
        windowDays: 7,
      },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Unknown engine "tenant-x" in engineB/)
    expect(queries).toEqual([])
  })

  it("reads 'nothing ended' as an unmeasured duration and suppresses its delta (N78)", async () => {
    // Both engines started 40 instances; only prod-a has completed any. prod-b
    // has no duration sample at all.
    const client: PrometheusClient = {
      instant: (q) =>
        Promise.resolve(
          q.includes("duration_milliseconds") && q.includes("prod-b")
            ? []
            : [{ metric: {}, value: q.includes("duration_milliseconds") ? 30_000 : 40 }],
        ),
    }
    const result = dataOf(
      await showEngineCompare(client).handler(
        {
          processDefinitionKey: "order",
          engineA: "prod-a",
          engineB: "prod-b",
          windowDays: 7,
          minBucketSize: 1,
        },
        {},
      ),
    )

    expect(result.kpis[1]).toMatchObject({
      avgDurationMs: null,
      medianDurationMs: null,
      p95DurationMs: null,
    })
    // Never a −100 % from a missing value.
    expect(result.delta).toMatchObject({ avgDurationDeltaPct: null, p95DurationDeltaPct: null })
  })

  it("prefers an explicit minBucketSize over the schema default", async () => {
    const { client } = recordingClient()
    const { definition, handler } = showEngineCompare(client)
    // mcp-use parses the input before the handler runs, so an omitted value takes the default.
    const parsed = (input: Record<string, unknown>) => definition.inputSchema.parse(input)
    const input = { processDefinitionKey: "order", engineA: "prod-a", engineB: "prod-b" }

    const explicit = dataOf(await handler(parsed({ ...input, minBucketSize: 3 }), {}))
    const fallback = dataOf(await handler(parsed(input), {}))

    expect(explicit.minBucketSize).toBe(3)
    expect(fallback.minBucketSize).toBe(10)
  })
})

describe("analytics_show_engine_compare registration", () => {
  const { definition } = showEngineCompare(recordingClient().client)

  it("tells the model why the process scope is mandatory", () => {
    // The parameter is where this tool says why its scope is mandatory; the instructions' rate rule
    // states the process-mix reason for every analytics tool.
    const { description } = definition.inputSchema.shape.processDefinitionKey as z.ZodType
    expect(description).toContain("REQUIRED")
    expect(description).toContain("process mixes")
    expect(description).toContain("analytics_show_engine_landscape")
  })

  it("requires processDefinitionKey at the schema boundary", () => {
    const parsed = definition.inputSchema.safeParse({ engineA: "prod-a", engineB: "prod-b" })
    expect(parsed.success).toBe(false)
    expect(
      definition.inputSchema.safeParse({
        processDefinitionKey: "",
        engineA: "prod-a",
        engineB: "prod-b",
      }).success,
    ).toBe(false)
  })
})
