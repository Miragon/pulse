import { beforeEach, describe, expect, it } from "vitest"
import type { PrometheusClient, VersionCompareResult } from "@miragon/pulse-analytics-client"
import type { RegisteredToolMeta, ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import { createEngineScope } from "../engine-ids.js"
import { registerVersionCompareTools } from "./version-compare.js"

type Config = ToolConfig<PrometheusClient>

function captureConfig(): Config {
  const configs: Config[] = []
  const register = Object.assign((config: Config) => configs.push(config), {
    getRegisteredTools: (): RegisteredToolMeta[] => [],
  })
  registerVersionCompareTools(register as never, createEngineScope(["prod-a"]))
  expect(configs.map((c) => c.name)).toEqual(["analytics_version_compare"])
  return configs[0]
}

/** Answers 20 per query. */
function recordingClient(): { client: PrometheusClient; queries: string[] } {
  const queries: string[] = []
  return {
    client: {
      instant: (query: string) => {
        queries.push(query)
        return Promise.resolve([{ metric: {}, value: 20 }])
      },
    },
    queries,
  }
}

const args = { processDefinitionKey: "order", versionA: 1, versionB: 2, windowDays: 14 }

describe("analytics_version_compare", () => {
  // Per test, so a registration that registers nothing fails a test, not collection.
  let config: Config
  beforeEach(() => {
    config = captureConfig()
  })

  it("reads incidents per version, on the version label (#337)", async () => {
    const { client, queries } = recordingClient()
    const res = (await config.handler(client, { ...args })) as VersionCompareResult

    const incidentQueries = queries.filter((q) => q.includes("camunda_incident_created_total"))
    expect(incidentQueries).toHaveLength(2)
    expect(incidentQueries.map((q) => /process_definition_version="(\d+)"/.exec(q)?.[1])).toEqual([
      "1",
      "2",
    ])
    for (const kpi of res.kpis) {
      expect(kpi).toMatchObject({
        instance_count: 20,
        incident_count: 20,
        incident_rate_pct: 100,
        element_incident_count: null,
        element_incident_rate_pct: null,
      })
    }
    expect(res.delta.incident_rate_delta_pp).toBe(0)
  })

  it("tells the model the incident figures are per version and the comparison process-wide", () => {
    expect(config.description).toContain("process-instance and incident series")
    expect(config.description).toContain("element_incident_* fields stay null")
  })

  it("accepts the version-compare input plus the optional minBucketSize override", () => {
    expect(Object.keys(config.inputSchema ?? {})).toEqual(
      expect.arrayContaining(["processDefinitionKey", "versionA", "versionB", "minBucketSize"]),
    )
  })

  it("registers as a read-only external read under the analytics category", () => {
    expect(config.category).toBe("analytics")
    expect(config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })

  it("prefers an explicit minBucketSize over the resolved setting", async () => {
    const { client } = recordingClient()
    const explicit = (await config.handler(client, {
      ...args,
      minBucketSize: 3,
    })) as VersionCompareResult
    const fallback = (await config.handler(client, { ...args })) as VersionCompareResult
    expect(explicit.minBucketSize).toBe(3)
    expect(fallback.minBucketSize).toBe(10)
  })
})
