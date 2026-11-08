import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootedServer } from "./boot-server.js"
import { isModelVisible } from "./golden.js"

/**
 * Strict tool inputs on the wire (#329). A non-strict input schema lets the
 * server STRIP an unknown key before the handler runs: a misnamed optional
 * filter (`processDefinitionKey` on a tool that only knows
 * `processDefinitionId`) then returned engine-wide results with no error, and
 * the model attributed them to the process it asked about. Every tool
 * (model-facing tools AND the app-only `*_data` feeds, which our own widgets
 * call; a stale widget argument must surface as an error, not as quietly
 * unfiltered data) must refuse an unknown key with a tool error that names
 * the valid keys, and advertise `additionalProperties: false`.
 */

interface WireTool {
  name: string
  inputSchema: { properties?: Record<string, unknown>; additionalProperties?: unknown }
  _meta?: { ui?: { visibility?: unknown } } & Record<string, unknown>
}

const PROBE_KEY = "__strictInputProbe"

function errorText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((part) => part.text ?? "").join("\n")
}

describe("strict tool inputs on the wire (full surface)", () => {
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    server = await bootServer({
      env: {
        MCP_ACTIVE_MODULES: "engine:admin",
        ENGINE_ALLOW_DEPLOYMENTS: "true",
      },
    })
    tools = (await server.client.listTools()).tools
  })

  afterAll(async () => {
    await server?.close()
  })

  it("covers every tool, model-facing and app-only (the guard is not vacuous)", () => {
    // The engine module's tools.
    expect(tools.every((tool) => tool.name.startsWith("engine_"))).toBe(true)
    // The model-visible floor is pinned at the engine module's count.
    expect(tools.filter(isModelVisible).length).toBeGreaterThanOrEqual(47)
    expect(tools.filter((tool) => !isModelVisible(tool)).length).toBeGreaterThanOrEqual(15)
    // The engine list and the history/stacktrace reads (#340) are probed like the rest.
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "engine_list_engines",
        "engine_query_historic_incidents",
        "engine_get_job_stacktrace",
      ]),
    )
  })

  it("every tool advertises additionalProperties: false", () => {
    const open = tools
      .filter((tool) => tool.inputSchema.additionalProperties !== false)
      .map((tool) => tool.name)
    expect(open, "tools whose advertised input accepts unknown keys").toEqual([])
  })

  // Strict input makes the vocabulary load-bearing: a model that learned a
  // name on one tool is REFUSED on the next tool that spells the same concept
  // differently. The naming guide (add-bpm-feature skill) names one spelling
  // per concept; these are the spellings it retired.
  it("no tool takes a name the naming guide replaced", () => {
    const RETIRED: Record<string, string> = {
      key: "processDefinitionKey",
      id: "<entity>Id",
      limit: "maxResults",
      elementId: "activityId",
      taskAssignee: "assignee",
      withIncidentsOnly: "withIncidents",
    }
    const offenders = tools.flatMap((tool) =>
      Object.keys(tool.inputSchema.properties ?? {})
        .filter((param) => Object.hasOwn(RETIRED, param))
        .map((param) => `${tool.name}.${param} → ${RETIRED[param]}`),
    )
    expect(offenders).toEqual([])
  })

  it("every tool refuses an unknown key with a tool error naming the valid keys", async () => {
    const failures: string[] = []
    for (const tool of tools) {
      const result = await server.client.callTool({
        name: tool.name,
        arguments: { [PROBE_KEY]: true },
      })
      const text = errorText(result)
      const valid = Object.keys(tool.inputSchema.properties ?? {})
      const named =
        valid.length === 0
          ? text.includes("This tool takes no arguments")
          : valid.every((key) => text.includes(JSON.stringify(key)))
      if (result.isError !== true || !text.includes(`Unknown key "${PROBE_KEY}"`) || !named) {
        failures.push(`${tool.name}: ${result.isError === true ? text : "accepted the call"}`)
      }
    }
    expect(failures).toEqual([])
  })
})
