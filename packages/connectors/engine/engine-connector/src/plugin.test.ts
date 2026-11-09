import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "./tools/test-support/feed-payload.js"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { Client } from "@miragon/pulse-c7-client"
import { z } from "zod"
import { createConfiguredEngineRegistry, createPlugin, type EnginePluginConfig } from "./plugin.js"
import { EngineNotSelectedError, resolveEngine } from "./lib/engine/resolve-engine.js"
import { camunda7Provider } from "./providers/index.js"
import { ENGINE_ADMIN_ONLY_TOOLS } from "./lib/mcp/toolsets.js"
import {
  ENGINE_LIST_ENGINES,
  ENGINE_OPEN_COCKPIT,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "./tool-names.js"
import { worldReply } from "./tools/test-support/engine-world.js"
import { type FakeEngine, startFakeEngine } from "./tools/test-support/fake-engine.js"

afterEach(() => {
  vi.restoreAllMocks()
})

interface Definition {
  name: string
  annotations?: Record<string, unknown>
  inputSchema?: z.ZodObject
}

async function bootSurface(config: Partial<EnginePluginConfig>) {
  const recording = recordingModuleServer()
  const plugin = createPlugin({
    engines: [{ id: "a", baseUrl: "http://a.example/engine-rest" }],
    ...config,
  })
  plugin.register(recording.server)
  const byName = new Map(
    [...recording.tools.values()].map(({ name, config, call }) => [
      name,
      { definition: { name, ...config } as Definition, handler: call },
    ]),
  )
  const feed = feedPayload<{ allowedActions: string[]; readOnlyEngines: string[] }>(
    await byName.get(ENGINE_WIDGET_ACTIONS_DATA)!.handler({}),
  )
  // The feed answers which writes the widgets may offer, and on which engines none: its shape is
  // the contract.
  expect(Object.keys(feed)).toEqual(["allowedActions", "readOnlyEngines"])
  return {
    names: [...byName.keys()],
    byName,
    allowedActions: feed.allowedActions,
    readOnlyEngines: feed.readOnlyEngines,
  }
}

describe("createPlugin toolset wiring (fail-closed)", () => {
  it("without a toolset boots the read-only floor on every path, never everything", async () => {
    const { names, byName, allowedActions } = await bootSurface({})
    for (const admin of ENGINE_ADMIN_ONLY_TOOLS) expect(names).not.toContain(admin)
    expect(names).not.toContain("engine_start_process_instance")
    expect(allowedActions).toEqual([])
    // The engine list is a read, so the floor keeps it.
    expect(byName.get(ENGINE_LIST_ENGINES)?.definition.annotations).toMatchObject({
      readOnlyHint: true,
    })
  })

  it("resolves an unknown toolset ONCE (one warning) and degrades every path to read-only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { names, allowedActions } = await bootSurface({ toolset: "superuser" })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "superuser"'))
    expect(names).not.toContain("engine_start_process_instance")
    expect(allowedActions).toEqual([])
  })

  it("operations: engine writes, no admin-only tool", async () => {
    const { names, allowedActions } = await bootSurface({
      toolset: "operations",
      allowDeployments: true,
    })
    expect(names).toContain("engine_start_process_instance")
    for (const admin of ENGINE_ADMIN_ONLY_TOOLS) expect(names).not.toContain(admin)
    expect(allowedActions).toContain("engine_resolve_incident")
  })

  it("threads allowDeployments to the registrar: create_deployment needs it on top of admin", async () => {
    expect((await bootSurface({ toolset: "admin" })).names).not.toContain(
      "engine_create_deployment",
    )
    expect((await bootSurface({ toolset: "admin", allowDeployments: true })).names).toContain(
      "engine_create_deployment",
    )
  })
})

/**
 * Every tool on the wire, not only the registrar's: the feeds, the widget-actions feed and the
 * cockpit register directly and skip the toolset filter, so a direct write would reach the
 * unauthenticated read-only surface unless its annotations stop it here.
 */
describe("createPlugin annotates every tool it registers", () => {
  it("the read-only floor registers readOnlyHint tools only, feeds and view tool included", async () => {
    const { byName } = await bootSurface({})
    expect([...byName.keys()]).toEqual(
      expect.arrayContaining([
        ENGINE_WIDGET_ACTIONS_DATA,
        "engine_jobs_data",
        "engine_open_cockpit",
      ]),
    )
    for (const { definition } of byName.values()) {
      expect(definition.annotations?.readOnlyHint, definition.name).toBe(true)
    }
  })

  // MCP reads an absent destructiveHint as `true`.
  it("every write on the full surface states destructiveHint", async () => {
    const { byName } = await bootSurface({ toolset: "admin", allowDeployments: true })
    const writes = [...byName.values()].filter(
      ({ definition }) => !definition.annotations?.readOnlyHint,
    )
    expect(writes.length).toBeGreaterThan(10)
    for (const { definition } of writes) {
      expect(typeof definition.annotations?.destructiveHint, definition.name).toBe("boolean")
    }
  })
})

// Structural, not a list: every tool that takes a page size caps it, the registrar reads and the
// app-only feeds alike.
describe("createPlugin caps every page size", () => {
  it("caps maxResults at 100 on every tool that takes it", async () => {
    const { byName } = await bootSurface({ toolset: "admin", allowDeployments: true })
    const paged = [...byName.values()].flatMap(({ definition }) => {
      const maxResults = definition.inputSchema?.shape.maxResults as z.ZodType | undefined
      return maxResults ? [{ name: definition.name, maxResults }] : []
    })
    expect(paged.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "engine_list_process_instances",
        "engine_jobs_data",
        "engine_process_instances_data",
        "engine_cluster_detail_data",
        "engine_activity_incidents_data",
      ]),
    )
    expect(paged.length).toBeGreaterThanOrEqual(16)
    for (const { name, maxResults } of paged) {
      expect((z.toJSONSchema(maxResults) as { maximum?: number }).maximum, name).toBe(100)
    }
  })
})

/** The advertised `engine` property of every tool that takes one, by tool name. */
async function engineParams(engines: EnginePluginConfig["engines"]) {
  const { byName } = await bootSurface({ engines, toolset: "admin", allowDeployments: true })
  return [...byName.values()].flatMap(({ definition }) => {
    const engine = definition.inputSchema?.shape.engine as z.ZodType | undefined
    return engine ? [{ name: definition.name, engine }] : []
  })
}

describe("createPlugin advertises `engine` as the boot-time enum of configured ids", () => {
  const TWO = [
    { id: "prod-a", baseUrl: "http://a.example/engine-rest" },
    { id: "prod-b", baseUrl: "http://b.example/engine-rest" },
  ]

  it("several engines: every tool with `engine` (registrar AND widget path) lists exactly the ids", async () => {
    const params = await engineParams(TWO)
    // Sanity: both paths carry the parameter; otherwise this test is vacuous.
    expect(params.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "engine_list_process_instances",
        "engine_open_cockpit",
        "engine_jobs_data",
      ]),
    )
    for (const { name, engine } of params) {
      const json = z.toJSONSchema(engine) as { enum?: string[]; description?: string }
      expect(json.enum, name).toEqual(["prod-a", "prod-b"])
      // No per-tool text: the routing rule is the instructions' (instructions.test.ts).
      expect(json.description, name).toBeUndefined()
      expect(engine.safeParse("prod-b").success, name).toBe(true)
      expect(engine.safeParse(undefined).success, name).toBe(true)
      expect(engine.safeParse("prod-c").success, name).toBe(false)
    }
  })

  it("one engine: `engine` stays a single-value enum; an explicit id is still accepted", async () => {
    const params = await engineParams([TWO[0]])
    expect(params.length).toBeGreaterThan(40)
    for (const { name, engine } of params) {
      expect((z.toJSONSchema(engine) as { enum?: string[] }).enum, name).toEqual(["prod-a"])
      expect(engine.safeParse("prod-a").success, name).toBe(true)
    }
  })
})

describe("createPlugin default-engine routing: the operator default", () => {
  const MULTI = [
    { id: "a", baseUrl: "http://a.example/engine-rest" },
    { id: "b", baseUrl: "http://b.example/engine-rest" },
  ]

  it("one engine: resolves it without a default", () => {
    const registry = registryOf({ engines: [MULTI[0]] })
    expect(resolveEngine(undefined, registry).engineId).toBe("a")
  })

  it("several engines with `defaultEngine`: a call without `engine` routes to it", () => {
    const registry = registryOf({ engines: MULTI, defaultEngine: "b" })
    expect(resolveEngine(undefined, registry).engineId).toBe("b")
    expect(resolveEngine("a", registry).engineId).toBe("a")
  })

  it("several engines, no default: a call without `engine` fails with ENGINE_NOT_SELECTED", () => {
    const registry = registryOf({ engines: MULTI })
    expect(() => resolveEngine(undefined, registry)).toThrow(EngineNotSelectedError)
  })
})

/** The registry createPlugin builds from the same config: per-engine auth and the default engine. */
function registryOf(config: EnginePluginConfig) {
  return createConfiguredEngineRegistry(config)
}

/** The Authorization a request of `client` carries on the wire, through its transport. */
async function authHeader(client: Client): Promise<string | null> {
  let sent: string | null = null
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    sent = new Headers(init.headers).get("Authorization")
    return Promise.resolve(Response.json({ version: "7.24.0" }))
  })
  try {
    await client.get({ url: "/version" })
  } finally {
    vi.unstubAllGlobals()
  }
  return sent
}

describe("createPlugin per-profile auth and deadline", () => {
  it("builds each engine's client from its own profile's auth, none without one", async () => {
    const registry = registryOf({
      engines: [
        {
          id: "a",
          baseUrl: "http://a.example/engine-rest",
          auth: { type: "basic", username: "demo", password: "secret" },
        },
        {
          id: "b",
          baseUrl: "http://b.example/engine-rest",
          auth: { type: "bearer", token: "tok-b" },
        },
        { id: "c", baseUrl: "http://c.example/engine-rest" },
      ],
    })

    expect(await authHeader(resolveEngine("a", registry).client)).toBe(
      `Basic ${Buffer.from("demo:secret").toString("base64")}`,
    )
    expect(await authHeader(resolveEngine("b", registry).client)).toBe("Bearer tok-b")
    expect(await authHeader(resolveEngine("c", registry).client)).toBeNull()
  })

  it("hands each client its profile's timeout, else ENGINE_REQUEST_TIMEOUT_MS, and its readOnly", () => {
    const createClient = vi.spyOn(camunda7Provider, "createClient")
    registryOf({
      engines: [
        { id: "a", baseUrl: "http://a.example/engine-rest", timeoutMs: 5_000, readOnly: true },
        { id: "b", baseUrl: "http://b.example/engine-rest" },
      ],
      requestTimeoutMs: 12_000,
    })
    expect(createClient.mock.calls.map(([entry, , settings]) => [entry.id, settings])).toEqual([
      ["a", { timeoutMs: 5_000, readOnly: true }],
      ["b", { timeoutMs: 12_000, readOnly: false }],
    ])
  })
})

describe("createPlugin: one live verdict for engine_status and the cockpit", () => {
  const started: FakeEngine[] = []
  afterEach(async () => {
    await Promise.all(started.splice(0).map((engine) => engine.close()))
  })

  /** The verdict and its rule from engine_status and from the cockpit's overview, on one engine. */
  async function verdicts(healthThresholds?: EnginePluginConfig["healthThresholds"]) {
    const engine = await startFakeEngine({}, worldReply)
    started.push(engine)
    const recording = recordingModuleServer()
    createPlugin({
      engines: [{ id: "a", baseUrl: engine.baseUrl }],
      ...(healthThresholds === undefined ? {} : { healthThresholds }),
    }).register(recording.server)
    const json = async (name: string) => {
      const result = await recording.tool(name).call({})
      return JSON.parse(result.content[0].text) as { status: string; statusRule: string }
    }
    return { status: await json("engine_status"), cockpit: await json(ENGINE_OPEN_COCKPIT) }
  }

  it("judges the world's open incident alike, by the defaults", async () => {
    const { status, cockpit } = await verdicts()
    expect([status.status, cockpit.status]).toEqual(["warning", "warning"])
    for (const rule of [status.statusRule, cockpit.statusRule]) {
      expect(rule).toContain(">=50 open incidents or >=25 of one cause")
    }
  })

  it("hands the deployment's ENGINE_HEALTH_* thresholds to both", async () => {
    const { status, cockpit } = await verdicts({ criticalIncidents: 1 })
    expect([status.status, cockpit.status]).toEqual(["critical", "critical"])
    for (const rule of [status.statusRule, cockpit.statusRule]) {
      expect(rule).toContain(">=1 open incidents or >=25 of one cause")
    }
  })
})
