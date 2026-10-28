import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "./tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import type { Client } from "@miragon/pulse-camunda7-client"
import { z } from "zod"
import {
  createInMemoryProfileStore,
  runWithMcpRequestInfo,
  type McpRequestInfo,
  type ProfileStore,
} from "@miragon/pulse-widget-shell/server"
import { createPlugin, type Camunda7PluginConfig } from "./plugin.js"
import {
  EngineNotSelectedError,
  resolveEngine,
  resolveStepEngine,
  type Camunda7StepAppConfig,
} from "./lib/resolve-engine.js"
import { CAMUNDA7_ADMIN_ONLY_TOOLS } from "./lib/toolsets.js"
import {
  CAMUNDA7_LIST_ENGINES,
  CAMUNDA7_SAVE_SETTINGS,
  CAMUNDA7_SELECT_ENGINE,
  CAMUNDA7_WIDGET_ACTIONS_DATA,
} from "./tool-names.js"

afterEach(() => {
  vi.restoreAllMocks()
})

async function bootSurface(config: Partial<Camunda7PluginConfig>) {
  const tool = vi.fn()
  const server = { tool, use: vi.fn(), prompt: vi.fn() } as unknown as MCPServer
  const plugin = createPlugin({
    engines: [{ id: "a", baseUrl: "http://a.example/engine-rest" }],
    ...config,
  })
  plugin.registerTools?.(server)
  plugin.registerWidgetTools?.(server)
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
    expect(names).not.toContain(CAMUNDA7_SAVE_SETTINGS)
    expect(allowedActions).toEqual([])
    // The engine list is a read; saving a default is a write the floor drops.
    expect(byName.get(CAMUNDA7_LIST_ENGINES)?.definition.annotations).toMatchObject({
      readOnlyHint: true,
    })
    expect(names).not.toContain(CAMUNDA7_SELECT_ENGINE)
  })

  it("resolves an unknown toolset ONCE (one warning) and degrades every path to read-only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { names, allowedActions } = await bootSurface({ toolset: "superuser" })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "superuser"'))
    expect(names).not.toContain("camunda7_start_process_instance")
    expect(names).not.toContain(CAMUNDA7_SAVE_SETTINGS)
    expect(allowedActions).toEqual([])
  })

  it("operations: engine writes + profile save, no admin-only tool", async () => {
    const { names, allowedActions } = await bootSurface({
      toolset: "operations",
      allowDeployments: true,
    })
    expect(names).toContain("camunda7_start_process_instance")
    expect(names).toContain(CAMUNDA7_SAVE_SETTINGS)
    expect(names).toContain(CAMUNDA7_SELECT_ENGINE)
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
          "camunda7_show_settings",
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

describe("ENGINE_NOT_SELECTED names camunda7_select_engine only when the caller could save", () => {
  const TWO = [
    { id: "a", baseUrl: "http://a.example/engine-rest" },
    { id: "b", baseUrl: "http://b.example/engine-rest" },
  ]
  /** A tool call's ctx for a signed-in caller (mcp-use's flattened `ctx.auth`). */
  const callAs = (id: string) => ({ auth: { user: { id } } })
  /**
   * The failure a tool call (`call` = its ctx) or a ctx-less pipeline step
   * (`call` omitted) sees under the ambient request info `info`.
   */
  const failure = async (toolset: string, call?: object, info: McpRequestInfo = {}) => {
    const plugin = createPlugin({ engines: TWO, toolset })
    const { registry } = plugin.appConfig as unknown as Camunda7StepAppConfig
    return runWithMcpRequestInfo(info, () =>
      resolveEngine(undefined, registry, call).then(
        () => undefined,
        (e: unknown) => e as Error,
      ),
    )
  }

  it("signed-in caller (the tool call's ctx) under operations: points at the save", async () => {
    const error = await failure("operations", callAs("user-1"))
    expect(error).toBeInstanceOf(EngineNotSelectedError)
    expect(error?.message).toBe(
      "No engine specified and no default engine saved. Pass `engine` — one of: a, b. " +
        "To route later calls without it, save a default with camunda7_select_engine.",
    )
  })

  it("a ctx-less pipeline step reads the ambient OAuth caller the same way", async () => {
    const error = await failure("operations", undefined, { authUserId: "user-1" })
    expect(error?.message).toContain("camunda7_select_engine")
  })

  it("no caller identity (no OAuth, no declared local caller): only the per-call override", async () => {
    for (const error of [
      await failure("operations", {}),
      await failure("operations", undefined, {}),
      await failure("operations"),
    ]) {
      expect(error?.message).toBe(
        "No engine specified and no default engine saved. Pass `engine` — one of: a, b.",
      )
    }
  })

  it("read-only toolset: only the per-call override, even when signed in", async () => {
    const error = await failure("read-only", callAs("user-1"))
    expect(error?.message).not.toContain("camunda7_select_engine")
  })
})

describe("createPlugin default-engine routing — the saved default is advisory", () => {
  /** A preferences database that is down: the driver error names its host:port. */
  const downStore = () => {
    const fail = () =>
      Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" }),
      )
    return { get: vi.fn(fail), save: fail, delete: fail }
  }
  /** A tool call's ctx for a signed-in caller (mcp-use's flattened `ctx.auth`). */
  const callAs = (id: string) => ({ auth: { user: { id } } })
  const MULTI = [
    { id: "a", baseUrl: "http://a.example/engine-rest" },
    { id: "b", baseUrl: "http://b.example/engine-rest" },
  ]
  const registryOf = (engines: Camunda7PluginConfig["engines"], profileStore: ProfileStore) =>
    (createPlugin({ engines }, { profileStore }).appConfig as unknown as Camunda7StepAppConfig)
      .registry

  it("one engine: resolves it without consulting the profile store at all", async () => {
    const store = downStore()
    const registry = registryOf([MULTI[0]], store)
    expect((await resolveEngine(undefined, registry)).engineId).toBe("a")
    expect(store.get).not.toHaveBeenCalled()
  })

  it("an explicit engine resolves during an outage", async () => {
    const registry = registryOf(MULTI, downStore())
    expect((await resolveEngine("b", registry)).engineId).toBe("b")
  })

  it("several engines, none named: the outage degrades to 'no saved default' — no host:port", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registry = registryOf(MULTI, downStore())
    const error = await resolveEngine(undefined, registry, callAs("user-1")).then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(error).toBeInstanceOf(EngineNotSelectedError)
    expect(error?.message).not.toMatch(/10\.1\.2\.3|5432|ECONNREFUSED/)
    // Logged for operators — sanitized to the error class + code.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Error ECONNREFUSED"))
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/10\.1\.2\.3|5432/)
  })

  it("several engines, store healthy: the CALLER's saved default routes — nobody else's", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { modules: { camunda7: { defaultEngineId: "b" } } })
    const registry = registryOf(MULTI, store)
    expect((await resolveEngine(undefined, registry, callAs("user-1"))).engineId).toBe("b")
    // Another signed-in caller, or no caller identity at all, has no default.
    await expect(resolveEngine(undefined, registry, callAs("user-2"))).rejects.toBeInstanceOf(
      EngineNotSelectedError,
    )
    await expect(resolveEngine(undefined, registry)).rejects.toBeInstanceOf(EngineNotSelectedError)
  })

  it("a ctx-less pipeline step routes by the ambient OAuth caller", async () => {
    const store = createInMemoryProfileStore()
    await store.save("user-1", { modules: { camunda7: { defaultEngineId: "b" } } })
    const appConfig = createPlugin({ engines: MULTI }, { profileStore: store })
      .appConfig as unknown as Camunda7StepAppConfig
    const step = await runWithMcpRequestInfo({ authUserId: "user-1" }, () =>
      resolveStepEngine(appConfig),
    )
    expect(step.engineId).toBe("b")
  })
})

function authHeader(client: Client): string | null {
  return (client.getConfig().headers as Headers).get("Authorization")
}

describe("createPlugin per-engine auth", () => {
  it("builds each engine's client from its own auth, falling back to the module-wide config", async () => {
    const plugin = createPlugin({
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
    const { registry } = plugin.appConfig as unknown as Camunda7StepAppConfig

    expect(authHeader((await resolveEngine("a", registry)).client)).toBe(
      `Basic ${Buffer.from("demo:secret").toString("base64")}`,
    )
    expect(authHeader((await resolveEngine("b", registry)).client)).toBe("Bearer tok-b")
    expect(authHeader((await resolveEngine("c", registry)).client)).toBeNull()
  })

  it("does not mix per-engine auth fields with the module-wide credentials", async () => {
    const plugin = createPlugin({
      engines: [
        // Declares its own auth but no token — must NOT inherit the global
        // basic credentials and must send no Authorization header at all.
        { id: "solo", baseUrl: "http://solo.example/engine-rest", auth: { type: "bearer" } },
      ],
      authType: "basic",
      username: "demo",
      password: "secret",
    })
    const { registry } = plugin.appConfig as unknown as Camunda7StepAppConfig

    expect(authHeader((await resolveEngine("solo", registry)).client)).toBeNull()
  })
})
