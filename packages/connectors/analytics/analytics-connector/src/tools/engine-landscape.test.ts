import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { PrometheusClient, PromSample } from "@miragon/pulse-analytics-client"
import type { RegisteredToolMeta, ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import { createEngineScope } from "../engine-ids.js"
import { registerEngineLandscapeTools } from "./engine-landscape.js"

/** prod-c reports nothing. */
const scope = createEngineScope(["prod-a", "prod-b", "prod-c"])
const register = (r: never) => registerEngineLandscapeTools(r, scope)

type Config = ToolConfig<PrometheusClient>

function captureConfigs(registerModule: (register: never) => void): Map<string, Config> {
  const configs = new Map<string, Config>()
  const register = Object.assign(
    (config: Config) => {
      configs.set(config.name, config)
    },
    { getRegisteredTools: (): RegisteredToolMeta[] => [] },
  )
  registerModule(register as never)
  return configs
}

function captureHandlers(registerModule: (register: never) => void) {
  const configs = captureConfigs(registerModule)
  return new Map([...configs].map(([name, c]) => [name, c.handler]))
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

describe("analytics_engine_landscape", () => {
  it("builds the inventory matrix and issues one node-folded query per metric", async () => {
    const handlers = captureHandlers(register)
    const { client, queries } = recordingClient()

    const result = (await handlers.get("analytics_engine_landscape")!(client, {})) as {
      engines: Array<{ engineId: string; runningInstances: number }>
      sharedProcessKeys: string[]
    }

    // Engine omitted = the configured fleet: the silent prod-c stays visible.
    expect(result.engines.map((e) => e.engineId)).toEqual(["prod-a", "prod-b", "prod-c"])
    expect(result.engines[0].runningInstances).toBe(5)
    // Each engine runs its own definition — nothing to compare like-for-like.
    expect(result.sharedProcessKeys).toEqual([])
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
    const handlers = captureHandlers(register)
    const { client, queries } = recordingClient()

    const result = (await handlers.get("analytics_engine_landscape")!(client, {
      engine: ["prod-a", "prod-c"],
    })) as { engines: Array<{ engineId: string; reporting: boolean }> }

    expect(queries.every((q) => q.includes('{engine_id=~"prod-a|prod-c"}'))).toBe(true)
    expect(result.engines.find((e) => e.engineId === "prod-c")).toMatchObject({ reporting: false })
  })

  it("never lists another tenant's engine from a shared Prometheus (N138)", async () => {
    const handlers = captureHandlers(register)
    const { client, queries } = recordingClient()

    await expect(
      handlers.get("analytics_engine_landscape")!(client, { engine: ["prod-a", "tenant-x"] }),
    ).rejects.toThrow(/Unknown engine "tenant-x"/)
    expect(queries).toEqual([])
  })
})

describe("analytics_engine_landscape registration", () => {
  const config = captureConfigs(register).get("analytics_engine_landscape")!

  it("registers under the analytics category as a read-only external read", () => {
    expect(config.category).toBe("analytics")
    expect(config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })

  it("tells the model that counts — not per-engine rates — are the point", () => {
    // Else the model divides counts back into per-engine rates, the confound the view avoids.
    expect(config.description).toContain("counts, not rates")
    expect(config.description).toContain("process mixes")
    expect(config.description).toContain("sharedProcessKeys")
  })

  it("accepts an engine list or nothing at all", () => {
    const schema = z.object(config.inputSchema)
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ engine: ["prod-a", "prod-b"] }).success).toBe(true)
    expect(schema.safeParse({ engine: "prod-a" }).success).toBe(true)
  })
})
