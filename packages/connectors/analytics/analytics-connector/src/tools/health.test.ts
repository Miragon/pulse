import { describe, expect, it } from "vitest"
import {
  ENGINE_HEALTH_STATUS_RULE,
  type EngineHealthResult,
  type PrometheusClient,
  type PromSample,
} from "@miragon/pulse-analytics-client"
import type { RegisteredToolMeta, ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import { createEngineScope } from "../engine-ids.js"
import { registerHealthTools } from "./health.js"

type Config = ToolConfig<PrometheusClient>

const scope = createEngineScope(["prod-a", "prod-b"])

function captureConfig(): Config {
  const configs: Config[] = []
  const register = Object.assign((config: Config) => configs.push(config), {
    getRegisteredTools: (): RegisteredToolMeta[] => [],
  })
  registerHealthTools(register as never, scope)
  return configs[0]
}

function recordingClient(answer: (query: string) => PromSample[] = () => []) {
  const queries: string[] = []
  const client: PrometheusClient = {
    instant: (query: string) => {
      queries.push(query)
      return Promise.resolve(answer(query))
    },
  }
  return { client, queries }
}

const run = (client: PrometheusClient, args: Record<string, unknown>) =>
  captureConfig().handler(client, args, {} as never) as Promise<EngineHealthResult>

/** Prometheus where only `prod-a` reports its engine-state gauges (when the selector admits it). */
const onlyProdAReports = (query: string): PromSample[] =>
  query.includes("prod-a") &&
  (query.includes("camunda_jobs_executable") || query.includes("camunda_external_tasks_open"))
    ? [{ metric: { engine_id: "prod-a" }, value: 0 }]
    : []

describe("analytics_engine_health — engine scope (N138)", () => {
  it("with engine omitted, judges exactly the configured fleet — never every engine Prometheus holds", async () => {
    const { client, queries } = recordingClient()
    const result = await run(client, {})

    expect(result.engines).toEqual(["prod-a", "prod-b"])
    expect(queries.every((q) => q.includes('engine_id=~"prod-a|prod-b"'))).toBe(true)
  })

  it("refuses an engine id this server is not configured for, before any query", async () => {
    const { client, queries } = recordingClient()
    await expect(run(client, { engine: "tenant-x" })).rejects.toThrow(
      /Unknown engine "tenant-x".*configured engines: prod-a, prod-b/,
    )
    expect(queries).toEqual([])
  })
})

describe("analytics_engine_health — verdict (N76)", () => {
  it("reads a Prometheus without any metrics of the fleet as unknown, never healthy", async () => {
    const { client } = recordingClient()
    const result = await run(client, {})
    expect(result.status).toBe("unknown")
    expect(result.silentEngines).toEqual(["prod-a", "prod-b"])
  })

  it("reads a silent engine as unknown, not as an idle healthy one", async () => {
    const { client } = recordingClient(onlyProdAReports)
    const result = await run(client, { engine: "prod-b" })
    expect(result).toMatchObject({
      status: "unknown",
      engines: ["prod-b"],
      reportingEngines: [],
      silentEngines: ["prod-b"],
    })
  })

  it("degrades the fleet verdict while one configured engine is silent", async () => {
    const { client } = recordingClient(onlyProdAReports)
    const result = await run(client, {})
    expect(result).toMatchObject({
      status: "degraded",
      reportingEngines: ["prod-a"],
      silentEngines: ["prod-b"],
    })
  })
})

describe("analytics_engine_health — alerts (N76)", () => {
  const alertQueries = (queries: string[]) => queries.filter((q) => q.includes("ALERTS"))

  it("scopes one engine's verdict to that engine's alerts only", async () => {
    const { client, queries } = recordingClient()
    await run(client, { engine: "prod-a" })
    expect(alertQueries(queries)).toEqual([
      'ALERTS{alertstate="firing",engine_id="prod-a"}',
      'ALERTS{alertstate="pending",engine_id="prod-a"}',
    ])
  })

  it.each([
    ["engine omitted", {}, "prod-a|prod-b"],
    ["every configured engine named", { engine: ["prod-b", "prod-a"] }, "prod-b|prod-a"],
  ])(
    "adds the module's own engine-less alerts to a verdict over the whole fleet (%s)",
    async (_case, args, ids) => {
      const { client, queries } = recordingClient()
      await run(client, args)
      expect(alertQueries(queries)[0]).toBe(
        `ALERTS{alertstate="firing",engine_id=~"${ids}"} or ` +
          'ALERTS{alertstate="firing",alertname=~"CibSeven.+",engine_id=""}',
      )
    },
  )

  it("never lets a foreign critical alert in a shared Prometheus decide the verdict", async () => {
    // Somebody else's alert without engine_id: the scoped selector never matches it.
    const { client, queries } = recordingClient(onlyProdAReports)
    const result = await run(client, { engine: "prod-a" })
    expect(alertQueries(queries).some((q) => !q.includes('engine_id="prod-a"'))).toBe(false)
    expect(result.status).toBe("healthy")
  })
})

/** #340: each health tool states its rules and routes to the other. */
describe("analytics_engine_health verdict labeling", () => {
  it("carries the status rule — including the unknown verdict — in every result", async () => {
    const { client } = recordingClient()
    const result = await run(client, {})
    expect(result.statusRule).toBe(ENGINE_HEALTH_STATUS_RULE)
    expect(ENGINE_HEALTH_STATUS_RULE).toMatch(
      /^From Prometheus, over the engines in scope: unknown when none of them reports metrics;/,
    )
  })

  it("states the rule, the engine scope and the routing to camunda7_show_engine_health", () => {
    const { description } = captureConfig()
    expect(description).toContain(`Status: ${ENGINE_HEALTH_STATUS_RULE}`)
    expect(description).toContain("the silent ones (`silentEngines`")
    expect(description).toContain(
      "Use for fleet-wide or metric-based health; for one engine's live incident clusters use camunda7_show_engine_health.",
    )
  })
})
