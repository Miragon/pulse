import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootedServer } from "./boot-server.js"
import { INSTANCE_KEY, clusterWorld } from "./engine-goldens/c8-cluster-world.js"
import { type FakeC8Cluster, startC8Cluster } from "./engine-goldens/fake-c8-cluster.js"
import { GOLDEN_DIR, isModelVisible } from "./golden.js"

/**
 * The server serves a Camunda 8 engine on boards only, and every other path refuses it before a
 * single request (invariant 2, ENGINE_DIALECT_NOT_SERVED): the real boot over a camunda8 profile
 * of the client credentials grant, the full surface (admin, deployments allowed), a loopback
 * cluster and token endpoint that count every request. Every tool and feed of the admin golden is
 * classified here, so a new tool fails until it is: the ones that serve such an engine, the one
 * that reads no engine, and the rest, each called with arguments valid by its own input schema,
 * answers with the refusal while the cluster and its token endpoint see nothing.
 */

/** Read such an engine: the engine list, the cockpit's board and landing, the board and XML feeds. */
const SERVE = [
  "engine_list_engines",
  "engine_open_cockpit",
  "engine_board_data",
  "engine_bpmn_xml_data",
] as const

/** Reads no engine at all: it lists such an engine among those no write reaches. */
const NOT_APPLICABLE = ["engine_widget_actions_data"] as const

/** Values the schema alone cannot say, where a tool's own rules ask for one. */
const OVERRIDES: Readonly<Record<string, Record<string, unknown>>> = {
  engine_inspect_process_instance: { processInstanceId: INSTANCE_KEY },
}

/** The engine views of the cockpit, each with the ids its route requires. */
const ENGINE_VIEWS: Readonly<Record<string, Record<string, unknown>>> = {
  overview: {},
  incidents: {},
  "cluster-detail": { activityId: "Activity_ChargePayment", incidentType: "failedJob" },
  "process-detail": { processDefinitionKey: "pulse-order" },
  "process-instances": {},
  "instance-detail": { processInstanceId: INSTANCE_KEY },
  "incident-detail": { incidentId: "2251799813685382" },
  jobs: {},
  history: { processInstanceId: INSTANCE_KEY },
}

const REFUSAL =
  '[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine, and this tool or view reads ' +
  "the Camunda 7 REST API (Camunda 7, CIB seven, Operaton), so nothing was sent. This server " +
  'reads a Camunda 8 engine on boards only, and no board names "c8" yet; the server\'s ' +
  "operator adds one."

interface JsonSchema {
  type?: string
  enum?: readonly unknown[]
  pattern?: string
  exclusiveMinimum?: number
  minimum?: number
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
}

interface WireTool {
  name: string
  inputSchema: JsonSchema
  _meta?: { ui?: { visibility?: unknown } } & Record<string, unknown>
}

/** A value `schema` takes; `key` names an instance by the world's key. */
function valueOf(schema: JsonSchema, key: string): unknown {
  if (schema.enum !== undefined) return schema.enum[0]
  switch (schema.type) {
    case "string":
      return /processInstanceIds?$/.test(key) ? INSTANCE_KEY : "pulse-order"
    case "integer":
    case "number":
      return schema.minimum ?? (schema.exclusiveMinimum ?? 0) + 1
    case "boolean":
      return true
    case "array":
      return [valueOf(schema.items ?? {}, key)]
    case "object":
      return requiredOf(schema)
    default:
      return "pulse-order"
  }
}

/** The required properties of an object schema, each with a value it takes. */
function requiredOf(schema: JsonSchema): Record<string, unknown> {
  return Object.fromEntries(
    (schema.required ?? []).map((key) => [key, valueOf(schema.properties?.[key] ?? {}, key)]),
  )
}

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ text?: string }> }).content ?? [])
    .map((part) => part.text ?? "")
    .join("")

const goldenNames = (): string[] =>
  (
    JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, "tools-admin.json"), "utf8")) as WireTool[]
  ).map(({ name }) => name)

describe("a Camunda 8 engine on the full surface: boards read it, every other path refuses it", () => {
  let c8: FakeC8Cluster
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    c8 = await startC8Cluster(clusterWorld)
    server = await bootServer({
      env: {
        MCP_ACTIVE_MODULES: "engine:admin",
        ENGINE_ALLOW_DEPLOYMENTS: "true",
        ENGINE_BASE_URL: undefined,
        ENGINES_JSON: JSON.stringify({ profiles: { c8: c8.profile("ENGINE_SECRET_C8_CLIENT") } }),
        ENGINE_SECRET_C8_CLIENT: "s3cret-of-the-client",
      },
    })
    tools = (await server.client.listTools()).tools as WireTool[]
  })

  afterAll(async () => {
    await server?.close()
    await c8?.close()
  })

  /** Every tool of the golden that refuses such an engine. */
  const refusing = () => {
    const kept: readonly string[] = [...SERVE, ...NOT_APPLICABLE]
    return tools.filter(({ name }) => !kept.includes(name))
  }

  it("classifies every tool and feed of the admin golden: 4 serve, 1 reads no engine, 58 refuse", () => {
    expect(tools.map(({ name }) => name).sort()).toEqual(goldenNames().sort())
    const named = new Set(tools.map(({ name }) => name))
    for (const name of [...SERVE, ...NOT_APPLICABLE]) expect(named.has(name), name).toBe(true)
    const refused = refusing()
    expect(refused).toHaveLength(58)
    expect(refused.filter(isModelVisible)).toHaveLength(45)
    expect(refused.filter((tool) => !isModelVisible(tool))).toHaveLength(13)
  })

  it("refuses each with arguments valid by its schema, and nothing reaches the cluster", async () => {
    const answers: string[] = []
    for (const tool of refusing()) {
      const args = { ...requiredOf(tool.inputSchema), ...OVERRIDES[tool.name], engine: "c8" }
      const result = await server.client.callTool({ name: tool.name, arguments: args })
      const text = textOf(result)
      answers.push(
        result.isError === true && text === REFUSAL ? "refused" : `${tool.name}: ${text}`,
      )
    }
    expect(answers.filter((answer) => answer !== "refused")).toEqual([])
    expect(c8.sent()).toEqual([])
  })

  it("refuses each engine view of the cockpit, and opens the picker without a view", async () => {
    for (const [view, ids] of Object.entries(ENGINE_VIEWS)) {
      const result = await server.client.callTool({
        name: "engine_open_cockpit",
        arguments: { engine: "c8", view, ...ids },
      })
      expect([view, result.isError, textOf(result)]).toEqual([view, true, REFUSAL])
    }
    const picker = await server.client.callTool({
      name: "engine_open_cockpit",
      arguments: { engine: "c8" },
    })
    expect(picker.isError).not.toBe(true)
    expect(picker.structuredContent).toMatchObject({ engineId: null, start: null })
    expect(c8.sent()).toEqual([])
  })

  it("reads it through the XML feed, its token from the token endpoint: the counts are real", async () => {
    const result = await server.client.callTool({
      name: "engine_bpmn_xml_data",
      arguments: { engine: "c8", processDefinitionId: "2251799813685326" },
    })
    // The world serves no diagram: the feed says the cluster's own answer, so it asked the cluster.
    expect(textOf(result)).toBe(
      "[404 Not Found] No endpoint GET /v2/process-definitions/2251799813685326/xml. (engine c8)",
    )
    expect(c8.tokenEndpoint.requests.map(({ method }) => method)).toEqual(["POST"])
    expect(c8.cluster.requests.map(({ method, target }) => `${method} ${target}`)).toContain(
      "GET /v2/topology",
    )
    expect(
      c8.cluster.requests.every(({ authorization }) => authorization === "Bearer c8-access-token"),
    ).toBe(true)
  })
})
