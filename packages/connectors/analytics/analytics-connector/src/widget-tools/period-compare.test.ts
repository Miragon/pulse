import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import {
  increaseIn,
  type PeriodCompareResult,
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
type Tool = { definition: Definition; handler: Handler }

const NAME = "analytics_show_period_compare"

function showTools(ch: PrometheusClient): Map<string, Tool> {
  const tools = new Map<string, Tool>()
  const server = {
    tool: (definition: Definition, handler: Handler) => {
      tools.set(definition.name, { definition, handler })
    },
  } as unknown as MCPServer
  registerWidgetTools(server, ch, { engineScope: createEngineScope(["prod-a", "prod-b"]) })
  return tools
}

const showPeriodCompare = (ch: PrometheusClient) => showTools(ch).get(NAME)!

function recordingClient(value?: number): { client: PrometheusClient; queries: string[] } {
  const queries: string[] = []
  return {
    client: {
      instant: (query: string) => {
        queries.push(query)
        return Promise.resolve(value === undefined ? [] : [{ metric: {}, value }])
      },
    },
    queries,
  }
}

const dataOf = (result: ToolResult) => result.structuredContent as unknown as PeriodCompareResult

describe("analytics_show_period_compare PromQL", () => {
  // Explicit periods are clamped to [now − retention, now]: pin now.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-02-10T00:00:00Z") })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it("queries each period via `[duration] @ end` historical windows", async () => {
    const { client, queries } = recordingClient()

    await showPeriodCompare(client).handler(
      {
        processDefinitionKey: "order",
        periodAFrom: "2026-01-20T00:00:00Z",
        periodATo: "2026-01-21T00:00:00Z",
        periodBFrom: "2026-02-01T00:00:00Z",
        periodBTo: "2026-02-03T00:00:00Z",
        minBucketSize: 10,
      },
      {},
    )

    const atA = Date.parse("2026-01-21T00:00:00Z") / 1000
    const atB = Date.parse("2026-02-03T00:00:00Z") / 1000
    const windowA = `[86400s] @ ${atA}`
    const windowB = `[172800s] @ ${atB}`
    const fleet = 'engine_id=~"prod-a|prod-b"'
    // 6 KPI queries per period (the median included), period A first.
    expect(queries).toHaveLength(12)
    expect(queries.slice(0, 6).every((q) => q.includes(windowA))).toBe(true)
    expect(queries.slice(6).every((q) => q.includes(windowB))).toBe(true)
    const started = `camunda_process_instance_started_total{process_definition_key="order",${fleet}}`
    expect(queries[0]).toBe(`sum(${increaseIn(started, { range: "86400s", at: atA })})`)
    expect(queries[6]).toBe(`sum(${increaseIn(started, { range: "172800s", at: atB })})`)
  })
})

describe("analytics_show_period_compare periods (N79)", () => {
  const NOW = Date.parse("2026-02-10T00:00:00Z")
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  const base = { processDefinitionKey: "order", minBucketSize: 10 }

  it("clamps a period reaching past now to now and reports what was measured", async () => {
    const { client, queries } = recordingClient()

    const result = dataOf(
      await showPeriodCompare(client).handler(
        {
          ...base,
          periodAFrom: "2026-02-01T00:00:00Z",
          periodATo: "2026-02-05T00:00:00Z",
          periodBFrom: "2026-02-05T00:00:00Z",
          periodBTo: "2026-02-15T00:00:00Z",
        },
        {},
      ),
    )

    // No `@` anchor in the future: Prometheus would answer with the elapsed
    // part while the period is reported at full length.
    expect(queries.slice(6).every((q) => q.includes(`[432000s] @ ${NOW / 1000}`))).toBe(true)
    expect(result.kpis[1]).toMatchObject({
      to: "2026-02-10T00:00:00.000Z",
      days: 5,
      partial: true,
    })
  })

  it("measures a recent deployment's period B up to now and says so", async () => {
    const { client, queries } = recordingClient(20)
    const split = NOW - 2 * 3_600_000
    const iso = (ms: number) => new Date(ms).toISOString()
    const result = await showPeriodCompare(client).handler(
      {
        ...base,
        periodAFrom: iso(split - 7 * 86_400_000),
        periodATo: iso(split),
        periodBFrom: iso(split),
        periodBTo: iso(split + 7 * 86_400_000),
      },
      {},
    )

    // No `@` anchor beyond now: period B is 2 h, not 7 d.
    const anchors = queries.flatMap((q) => [...q.matchAll(/@ (\d+)/g)].map((m) => Number(m[1])))
    expect(Math.max(...anchors)).toBe(NOW / 1000)
    const data = dataOf(result)
    expect(data.kpis.map((k) => k.days)).toEqual([7, 0.08])
    expect(data.kpis[1].partial).toBe(true)
    expect(data.partial).toBe(true)
    // 20 starts in 2 h vs 20 in 7 d is a huge rise PER DAY, never a flat 0 %.
    expect(data.delta.startedPerDayDeltaPct).toBe(8300)
    // The model reads the same figures.
    const model = JSON.parse(result.content[0].text) as PeriodCompareResult
    expect(model.kpis[1]).toMatchObject({ days: 0.08, partial: true })
    expect(model.delta.startedPerDayDeltaPct).toBe(8300)
  })

  it("refuses a reversed period instead of measuring a 1-second one", async () => {
    const { client, queries } = recordingClient()
    const result = await showPeriodCompare(client).handler(
      {
        ...base,
        periodAFrom: "2026-02-05T00:00:00Z",
        periodATo: "2026-02-01T00:00:00Z",
        periodBFrom: "2026-02-05T00:00:00Z",
        periodBTo: "2026-02-08T00:00:00Z",
      },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/periodA ends before it starts/)
    expect(queries).toEqual([])
  })

  it("refuses a period entirely before the retention", async () => {
    const { client, queries } = recordingClient()
    const result = await showPeriodCompare(client).handler(
      {
        ...base,
        periodAFrom: "2025-10-01T00:00:00Z",
        periodATo: "2025-10-08T00:00:00Z",
        periodBFrom: "2026-02-01T00:00:00Z",
        periodBTo: "2026-02-08T00:00:00Z",
      },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/periodA lies before the 30-day Prometheus retention/)
    expect(queries).toEqual([])
  })

  it("refuses a period B in the future instead of comparing an empty one", async () => {
    const { client, queries } = recordingClient()
    const result = await showPeriodCompare(client).handler(
      {
        ...base,
        periodAFrom: "2026-02-01T00:00:00Z",
        periodATo: "2026-02-08T00:00:00Z",
        periodBFrom: new Date(NOW + 3_600_000).toISOString(),
        periodBTo: new Date(NOW + 2 * 3_600_000).toISOString(),
      },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/periodB lies in the future/)
    expect(queries).toEqual([])
  })
})

/** mcp-use parses the input before the handler runs, so an omitted value takes the schema default. */
describe("analytics schema defaults", () => {
  function parsedCall(name: string) {
    return async (input: Record<string, unknown>) => {
      const { client, queries } = recordingClient()
      const { definition, handler } = showTools(client).get(name)!
      const args = definition.inputSchema.parse(input)
      const result = await handler(args, {})
      return { args, queries, result }
    }
  }

  it("an omitted period queries 7d", async () => {
    const call = parsedCall("analytics_show_dashboard")
    const { args, queries } = await call({ processDefinitionKey: "order" })
    expect(args.period).toBe("7d")
    expect(queries[0]).toContain("[7d]")
    expect((await call({ processDefinitionKey: "order", period: "30d" })).queries[0]).toContain(
      "[30d]",
    )
  })

  it("an omitted minBucketSize is 10 in the period comparison", async () => {
    const call = parsedCall(NAME)
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    const { args, result } = await call({
      processDefinitionKey: "order",
      periodAFrom: daysAgo(3),
      periodATo: daysAgo(2),
      periodBFrom: daysAgo(2),
      periodBTo: daysAgo(1),
    })
    expect(args.minBucketSize).toBe(10)
    expect(dataOf(result).minBucketSize).toBe(10)
  })
})
