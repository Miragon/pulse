import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "./tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import type { Client } from "@miragon/pulse-camunda7-client"
import { z } from "zod"
import { createCamunda7EngineRegistry, createPlugin, type Camunda7PluginConfig } from "./plugin.js"
import { EngineNotSelectedError, resolveEngine } from "./lib/resolve-engine.js"
import { CAMUNDA7_ADMIN_ONLY_TOOLS } from "./lib/toolsets.js"
import { CAMUNDA7_LIST_ENGINES, CAMUNDA7_WIDGET_ACTIONS_DATA } from "./tool-names.js"

afterEach(() => {
  vi.restoreAllMocks()
})

async function bootSurface(config: Partial<Camunda7PluginConfig>) {
  const tool = vi.fn()
  const server = { tool, prompt: vi.fn() } as unknown as MCPServer
  const plugin = createPlugin({
    engines: [{ id: "a", baseUrl: "http://a.example/engine-rest" }],
    ...config,
  })
  plugin.register(server)
  const calls = tool.mock.calls as Array<
    [
      {
        name: string
        annotations?: Record<string, unknown>
        inputSchema?: z.ZodObject
        visibility?: string
      },
      (p: unknown) => Promise<unknown>,
    ]
  >
  const byName = new Map(
    calls.map(([definition, handler]) => [definition.name, { definition, handler }]),
  )
  const feed = feedPayload<{ allowedActions: string[]; modelTools: string[] }>(
    await byName.get(CAMUNDA7_WIDGET_ACTIONS_DATA)!.handler({}),
  )
  return {
    names: [...byName.keys()],
    byName,
    allowedActions: feed.allowedActions,
    modelTools: feed.modelTools,
  }
}

describe("createPlugin toolset wiring (fail-closed)", () => {
  it("without a toolset boots the read-only floor on every path — never everything", async () => {
    const { names, byName, allowedActions } = await bootSurface({})
    for (const admin of CAMUNDA7_ADMIN_ONLY_TOOLS) expect(names).not.toContain(admin)
    expect(names).not.toContain("camunda7_start_process_instance")
    expect(allowedActions).toEqual([])
    // The engine list is a read, so the floor keeps it.
    expect(byName.get(CAMUNDA7_LIST_ENGINES)?.definition.annotations).toMatchObject({
      readOnlyHint: true,
    })
  })

  it("resolves an unknown toolset ONCE (one warning) and degrades every path to read-only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { names, allowedActions } = await bootSurface({ toolset: "superuser" })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "superuser"'))
    expect(names).not.toContain("camunda7_start_process_instance")
    expect(allowedActions).toEqual([])
  })

  it("operations: engine writes, no admin-only tool", async () => {
    const { names, allowedActions } = await bootSurface({
      toolset: "operations",
      allowDeployments: true,
    })
    expect(names).toContain("camunda7_start_process_instance")
    for (const admin of CAMUNDA7_ADMIN_ONLY_TOOLS) expect(names).not.toContain(admin)
    expect(allowedActions).toContain("camunda7_resolve_incident")
  })

  // #338: every registration path counts, never an app-only feed.
  it.each(["read-only", "operations", "admin"])(
    "%s: the feed's modelTools are exactly the registered model-visible tools",
    async (toolset) => {
      const { byName, modelTools } = await bootSurface({ toolset, allowDeployments: true })
      const visible = [...byName.values()]
        .filter(({ definition }) => definition.visibility !== "app")
        .map(({ definition }) => definition.name)
        .sort()
      expect(modelTools).toEqual(visible)
      expect(modelTools).toEqual(
        expect.arrayContaining([
          "camunda7_list_incidents",
          "camunda7_show_engine_health",
          "camunda7_open_cockpit",
        ]),
      )
      expect(modelTools).not.toContain(CAMUNDA7_WIDGET_ACTIONS_DATA)
      expect(modelTools.includes("camunda7_set_job_retries")).toBe(toolset !== "read-only")
      expect(modelTools.includes("camunda7_set_job_retries_batch")).toBe(toolset === "admin")
    },
  )

  it("threads allowDeployments to the registrar: create_deployment needs it on top of admin", async () => {
    expect((await bootSurface({ toolset: "admin" })).names).not.toContain(
      "camunda7_create_deployment",
    )
    expect((await bootSurface({ toolset: "admin", allowDeployments: true })).names).toContain(
      "camunda7_create_deployment",
    )
  })
})

/** The advertised `engine` property of every tool that takes one, by tool name. */
async function engineParams(engines: Camunda7PluginConfig["engines"]) {
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
    // Sanity: both paths carry the parameter — otherwise this test is vacuous.
    expect(params.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "camunda7_list_process_instances",
        "camunda7_show_engine_health",
        "camunda7_jobs_data",
      ]),
    )
    for (const { name, engine } of params) {
      const json = z.toJSONSchema(engine) as { enum?: string[]; description?: string }
      expect(json.enum, name).toEqual(["prod-a", "prod-b"])
      expect(json.description, name).toBe("Engine id (see server instructions)")
      expect(engine.safeParse("prod-b").success, name).toBe(true)
      expect(engine.safeParse(undefined).success, name).toBe(true)
      expect(engine.safeParse("prod-c").success, name).toBe(false)
    }
  })

  it("one engine: `engine` stays a single-value enum — an explicit id is still accepted", async () => {
    const params = await engineParams([TWO[0]])
    expect(params.length).toBeGreaterThan(40)
    for (const { name, engine } of params) {
      expect((z.toJSONSchema(engine) as { enum?: string[] }).enum, name).toEqual(["prod-a"])
      expect(engine.safeParse("prod-a").success, name).toBe(true)
    }
  })
})

describe("camunda7_show_engine_health states its verdict rule (#340)", () => {
  it("names the source and the deployment's OWN thresholds, and routes to analytics", async () => {
    const { byName } = await bootSurface({ healthThresholds: { criticalIncidents: 10 } })
    const description = (
      byName.get("camunda7_show_engine_health")?.definition as {
        description?: string
      }
    )?.description
    expect(description).toContain(
      "Verdict: From the engine's open incidents, read live: critical at >=10 open or >=25 in one cluster, degraded with any, else ok.",
    )
    expect(description).toContain("use analytics_engine_health")
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
function registryOf(config: Camunda7PluginConfig) {
  return createCamunda7EngineRegistry(config)
}

function authHeader(client: Client): string | null {
  return (client.getConfig().headers as Headers).get("Authorization")
}

describe("createPlugin per-engine auth", () => {
  it("builds each engine's client from its own auth, falling back to the module-wide config", () => {
    const registry = registryOf({
      engines: [
        { id: "a", baseUrl: "http://a.example/engine-rest" },
        {
          id: "b",
          baseUrl: "http://b.example/engine-rest",
          auth: { type: "bearer", token: "tok-b" },
        },
        { id: "c", baseUrl: "http://c.example/engine-rest", auth: { type: "none" } },
      ],
      authType: "basic",
      username: "demo",
      password: "secret",
    })

    expect(authHeader(resolveEngine("a", registry).client)).toBe(
      `Basic ${Buffer.from("demo:secret").toString("base64")}`,
    )
    expect(authHeader(resolveEngine("b", registry).client)).toBe("Bearer tok-b")
    expect(authHeader(resolveEngine("c", registry).client)).toBeNull()
  })

  it("does not mix per-engine auth fields with the module-wide credentials", () => {
    const registry = registryOf({
      engines: [
        // Declares its own auth but no token — must NOT inherit the global
        // basic credentials and must send no Authorization header at all.
        { id: "solo", baseUrl: "http://solo.example/engine-rest", auth: { type: "bearer" } },
      ],
      authType: "basic",
      username: "demo",
      password: "secret",
    })

    expect(authHeader(resolveEngine("solo", registry).client)).toBeNull()
  })
})
