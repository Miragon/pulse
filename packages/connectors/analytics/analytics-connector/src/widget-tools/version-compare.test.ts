import { beforeEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import type { PrometheusClient, VersionCompareResult } from "@miragon/pulse-analytics-client"
import { createEngineScope } from "../engine-ids.js"
import { registerWidgetTools } from "../widget-tools.js"

type ToolResult = {
  content: Array<{ type: string; text: string }>
  structuredContent: Record<string, unknown>
}
type Definition = { name: string; description: string; inputSchema: z.ZodObject }
type Handler = (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult>
type Tool = { definition: Definition; handler: Handler }

const NAME = "analytics_show_version_compare"

function showVersionCompare(ch: PrometheusClient): Tool {
  const tools = new Map<string, Tool>()
  const server = {
    tool: (definition: Definition, handler: Handler) => {
      tools.set(definition.name, { definition, handler })
    },
  } as unknown as MCPServer
  registerWidgetTools(server, ch, { engineScope: createEngineScope(["prod-a"]) })
  return tools.get(NAME)!
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

const dataOf = (result: ToolResult) => result.structuredContent as unknown as VersionCompareResult

describe("analytics_show_version_compare", () => {
  // Per test, so a registration that registers nothing fails a test, not collection.
  let tool: Tool
  let recording: ReturnType<typeof recordingClient>
  beforeEach(() => {
    recording = recordingClient()
    tool = showVersionCompare(recording.client)
  })

  it("reads incidents per version, on the version label (issue 337)", async () => {
    const res = dataOf(await tool.handler({ ...args, minBucketSize: 10 }, {}))

    const incidentQueries = recording.queries.filter((q) =>
      q.includes("camunda_incident_created_total"),
    )
    expect(incidentQueries).toHaveLength(2)
    expect(incidentQueries.map((q) => /process_definition_version="(\d+)"/.exec(q)?.[1])).toEqual([
      "1",
      "2",
    ])
    for (const kpi of res.kpis) {
      expect(kpi).toMatchObject({
        startedCount: 20,
        incidentsCreated: 20,
        incidentRatePct: 100,
        elementIncidentsCreated: null,
        elementIncidentRatePct: null,
      })
    }
    expect(res.delta.incidentRateDeltaPp).toBe(0)
  })

  it("tells the model the incident figures are per version and the comparison process-wide", () => {
    const { description } = tool.definition
    expect(description).toContain("an exact label on the instance and incident series")
    expect(description).toContain("incidents per 100 starts")
    expect(description).toContain("process-wide (no element scope)")
    // The incident metric carries the version label, so nothing per version is n/a.
    expect(description).not.toMatch(/n\/a|no version label/)
  })

  it("accepts the version-compare input, minBucketSize included", () => {
    expect(Object.keys(tool.definition.inputSchema.shape)).toEqual(
      expect.arrayContaining(["processDefinitionKey", "versionA", "versionB", "minBucketSize"]),
    )
  })

  it("prefers an explicit minBucketSize over the schema default", async () => {
    // mcp-use parses the input before the handler runs, so an omitted value takes the default.
    const parsed = (input: Record<string, unknown>) => tool.definition.inputSchema.parse(input)
    const explicit = dataOf(await tool.handler(parsed({ ...args, minBucketSize: 3 }), {}))
    const fallback = dataOf(await tool.handler(parsed(args), {}))
    expect(explicit.minBucketSize).toBe(3)
    expect(fallback.minBucketSize).toBe(10)
  })
})
