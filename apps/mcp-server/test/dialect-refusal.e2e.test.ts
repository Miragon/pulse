import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bootServer, type BootedServer } from "./boot-server.js"
import { INSTANCE_KEY, clusterWorld } from "./engine-goldens/c8-cluster-world.js"
import { type FakeC8Cluster, startC8Cluster } from "./engine-goldens/fake-c8-cluster.js"
import { GOLDEN_DIR, isModelVisible } from "./golden.js"

/**
 * The server serves a Camunda 8 engine on boards only, and offers it nowhere else (each tool's,
 * feed's and route's mark, invariants 1 and 2): the real boot over a camunda8 profile of the client
 * credentials grant, the full surface (admin, deployments allowed), a loopback cluster and token
 * endpoint that count every request. Every tool and feed of the admin golden is classified here, so
 * a new tool fails until it is: the ones that serve such an engine, the one that reads no engine,
 * and the rest. Alone, the engine leaves the rest unregistered. Beside a Camunda 7 engine, the rest
 * offer that engine alone in their `engine` enum, and the call-time net refuses the Camunda 8
 * default each of them goes to without `engine`, with arguments valid by its own input schema,
 * while the cluster and its token endpoint see nothing.
 */

/**
 * Read such an engine: the engine list, the cockpit's board and landing, the board and XML feeds,
 * the web app's screen feeds (an engine's processes, an instance, an incident's text).
 */
const SERVE = [
  "engine_list_engines",
  "engine_open_cockpit",
  "engine_board_data",
  "engine_bpmn_xml_data",
  "engine_screen_processes_data",
  "engine_screen_instance_data",
  "engine_screen_incident_text_data",
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

/** The Camunda 7 engine beside it, on a loopback port nothing listens on: never asked. */
const SHOP = "shop"

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
  inputSchema: JsonSchema & { properties?: { engine?: JsonSchema } }
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

/** Every tool of the golden that does not serve such an engine and reads one. */
const isRefusing = ({ name }: WireTool) =>
  !([...SERVE, ...NOT_APPLICABLE] as readonly string[]).includes(name)

/** The `engine` values a listed tool offers; none without the parameter. */
const offered = (tool: WireTool) => tool.inputSchema.properties?.engine?.enum

/** The server over the cluster's camunda8 profile `c8`, with `beside` and `env`. */
async function bootOver(
  c8: FakeC8Cluster,
  beside: Record<string, unknown> = {},
  env: Record<string, string> = {},
) {
  const server = await bootServer({
    env: {
      MCP_ACTIVE_MODULES: "engine:admin",
      ENGINE_ALLOW_DEPLOYMENTS: "true",
      ENGINE_BASE_URL: undefined,
      ENGINES_JSON: JSON.stringify({
        profiles: { c8: c8.profile("ENGINE_SECRET_C8_CLIENT"), ...beside },
      }),
      ENGINE_SECRET_C8_CLIENT: "s3cret-of-the-client",
      ...env,
    },
  })
  return { server, tools: (await server.client.listTools()).tools as WireTool[] }
}

describe("a Camunda 8 engine alone on the full surface: what serves it, and nothing else", () => {
  let c8: FakeC8Cluster
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    c8 = await startC8Cluster(clusterWorld)
    ;({ server, tools } = await bootOver(c8))
  })

  afterAll(async () => {
    await server?.close()
    await c8?.close()
  })

  it("classifies every tool and feed of the admin golden: 7 serve and are listed, 59 are not", () => {
    const golden = goldenNames()
    expect(tools.map(({ name }) => name).sort()).toEqual([...SERVE].sort())
    const absent = golden.filter((name) => !(SERVE as readonly string[]).includes(name))
    expect(absent).toHaveLength(59)
    expect(absent).toEqual(expect.arrayContaining([...NOT_APPLICABLE]))
    expect(golden.filter((name) => !isRefusing({ name } as WireTool))).toHaveLength(8)
    expect(c8.sent()).toEqual([])
  })

  it("its cockpit offers only the routes that serve it, and no engine of one", () => {
    const cockpit = tools.find(({ name }) => name === "engine_open_cockpit")!
    expect(Object.keys(cockpit.inputSchema.properties ?? {}).sort()).toEqual(["board", "view"])
    expect(cockpit.inputSchema.properties?.view?.enum).toEqual(["board", "landing"])
  })

  it("reads it through the web app's engine screen feed, in the screens' JSON form", async () => {
    const result = await server.client.callTool({
      name: "engine_screen_processes_data",
      arguments: { engine: "c8" },
    })
    expect(result.isError, textOf(result)).not.toBe(true)
    expect(JSON.parse(textOf(result))).toMatchObject({ engine: "c8", webApp: null })
    expect(c8.cluster.requests.map(({ method, target }) => `${method} ${target}`)).toContain(
      "POST /v2/process-definitions/search",
    )
  })

  it("reads an instance of it through the web app's instance screen feed, in the screens' JSON form", async () => {
    const result = await server.client.callTool({
      name: "engine_screen_instance_data",
      arguments: { engine: "c8", instance: INSTANCE_KEY },
    })
    expect(result.isError, textOf(result)).not.toBe(true)
    expect(JSON.parse(textOf(result))).toMatchObject({
      engine: "c8",
      instance: { id: INSTANCE_KEY },
      webApp: null,
      causes: null,
    })
    expect(c8.cluster.requests.map(({ method, target }) => `${method} ${target}`)).toContain(
      `GET /v2/process-instances/${INSTANCE_KEY}`,
    )
  })

  it("reads it through the XML feed, its token from the token endpoint: the counts are real", async () => {
    const result = await server.client.callTool({
      name: "engine_bpmn_xml_data",
      arguments: { engine: "c8", processDefinitionId: "2251799813685326" },
    })
    // The world serves no diagram: the feed says the cluster's own answer, so it asked the cluster,
    // with the contract's failure before it and the hint its failure carries after it.
    expect(textOf(result)).toBe(
      "[misconfigured] [404 Not Found] No endpoint GET /v2/process-definitions/2251799813685326/xml. " +
        "(engine c8) The profile's url must be the REST root of the cluster and end in /v2.",
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

describe("a Camunda 8 default beside a Camunda 7 engine: offered nowhere else, refused where a call goes to it", () => {
  let c8: FakeC8Cluster
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    c8 = await startC8Cluster(clusterWorld)
    ;({ server, tools } = await bootOver(
      c8,
      { [SHOP]: { url: "http://127.0.0.1:1/engine-rest" } },
      { ENGINE_DEFAULT: "c8" },
    ))
  })

  afterAll(async () => {
    await server?.close()
    await c8?.close()
  })

  it("classifies every tool and feed of the admin golden: 7 serve, 1 reads no engine, 58 offer only the Camunda 7 engine", () => {
    expect(tools.map(({ name }) => name).sort()).toEqual(goldenNames().sort())
    const refusing = tools.filter(isRefusing)
    expect(refusing).toHaveLength(58)
    expect(refusing.filter(isModelVisible)).toHaveLength(45)
    expect(refusing.filter((tool) => !isModelVisible(tool))).toHaveLength(13)
    expect(refusing.map((tool) => [tool.name, offered(tool)])).toEqual(
      refusing.map(({ name }) => [name, [SHOP]]),
    )
    const served = (name: string) => offered(tools.find((tool) => tool.name === name)!)
    expect(served("engine_bpmn_xml_data")).toEqual(["c8", SHOP])
    expect(served("engine_screen_processes_data")).toEqual(["c8", SHOP])
    expect(served("engine_screen_instance_data")).toEqual(["c8", SHOP])
    expect(served("engine_screen_incident_text_data")).toEqual(["c8", SHOP])
    // The cockpit's `engine` names every engine it shows; its routes of one engine refuse this one.
    expect(served("engine_open_cockpit")).toEqual(["c8", SHOP])
  })

  it("refuses each without `engine`, on the default, with arguments valid by its schema, and nothing reaches the cluster", async () => {
    const answers: string[] = []
    for (const tool of tools.filter(isRefusing)) {
      const args = { ...requiredOf(tool.inputSchema), ...OVERRIDES[tool.name] }
      const result = await server.client.callTool({ name: tool.name, arguments: args })
      const text = textOf(result)
      answers.push(
        result.isError === true && text === REFUSAL ? "refused" : `${tool.name}: ${text}`,
      )
    }
    expect(answers.filter((answer) => answer !== "refused")).toEqual([])
    expect(c8.sent()).toEqual([])
  })

  it("refuses each engine view of the cockpit on the default, and opens the picker without a view", async () => {
    for (const [view, ids] of Object.entries(ENGINE_VIEWS)) {
      const result = await server.client.callTool({
        name: "engine_open_cockpit",
        arguments: { view, ...ids },
      })
      expect([view, result.isError, textOf(result)]).toEqual([view, true, REFUSAL])
    }
    const picker = await server.client.callTool({ name: "engine_open_cockpit", arguments: {} })
    expect(picker.isError).not.toBe(true)
    expect(picker.structuredContent).toMatchObject({ engineId: null, start: null })
    expect(c8.sent()).toEqual([])
  })

  // A page's link or the chat: the view of an engine shown on boards only, never arguments the
  // tool does not take.
  it("refuses each engine view of the cockpit that names it, and opens the picker without a view", async () => {
    for (const [view, ids] of Object.entries(ENGINE_VIEWS)) {
      const result = await server.client.callTool({
        name: "engine_open_cockpit",
        arguments: { view, engine: "c8", ...ids },
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

  it("a call that names it anyway fails its input schema, before the net", async () => {
    const result = await server.client.callTool({
      name: "engine_list_process_instances",
      arguments: { engine: "c8" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(
      `Invalid arguments for tool engine_list_process_instances: engine: Invalid input: expected "${SHOP}"`,
    )
    expect(c8.sent()).toEqual([])
  })
})

describe("no default beside a Camunda 7 engine and a read-only one: a call without `engine` names what its enum offers", () => {
  let c8: FakeC8Cluster
  let server: BootedServer
  let tools: WireTool[]

  beforeAll(async () => {
    c8 = await startC8Cluster(clusterWorld)
    ;({ server, tools } = await bootOver(c8, {
      [SHOP]: { url: "http://127.0.0.1:1/engine-rest" },
      ro: { url: "http://127.0.0.1:2/engine-rest", readOnly: true },
    }))
  })

  afterAll(async () => {
    await server?.close()
    await c8?.close()
  })

  const notSelected = (ids: readonly unknown[]) =>
    `[ENGINE_NOT_SELECTED] No engine specified and no default engine configured. Pass \`engine\`, one of: ${ids.join(", ")}.`

  it("each tool and feed with an engine names exactly the engines its enum offers", async () => {
    const answers: string[] = []
    const withEngine = tools.filter((tool) => tool.name !== "engine_open_cockpit" && offered(tool))
    for (const tool of withEngine) {
      const args = { ...requiredOf(tool.inputSchema), ...OVERRIDES[tool.name] }
      const result = await server.client.callTool({ name: tool.name, arguments: args })
      const text = textOf(result)
      answers.push(text === notSelected(offered(tool)!) ? "named" : `${tool.name}: ${text}`)
    }
    expect(answers.filter((answer) => answer !== "named")).toEqual([])
    const offers = (name: string) => offered(tools.find((tool) => tool.name === name)!)
    expect(offers("engine_list_process_instances")).toEqual([SHOP, "ro"])
    expect(offers("engine_set_job_retries")).toEqual([SHOP])
    expect(offers("engine_bpmn_xml_data")).toEqual(["c8", SHOP, "ro"])
    expect(c8.sent()).toEqual([])
  })

  it("an engine view of the cockpit names the engines its route serves", async () => {
    const result = await server.client.callTool({
      name: "engine_open_cockpit",
      arguments: { view: "overview" },
    })
    expect([result.isError, textOf(result)]).toEqual([true, notSelected([SHOP, "ro"])])
    expect(c8.sent()).toEqual([])
  })
})
