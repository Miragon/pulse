import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import type { ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import {
  ANONYMOUS_PROFILE_KEY,
  createInMemoryProfileStore,
  runWithMcpRequestInfo,
  type McpRequestInfo,
  type ProfileStore,
} from "@miragon/pulse-widget-shell/server"
import type { Client } from "@miragon/pulse-camunda7-client"
import type { MCPServer } from "mcp-use"
import { registerEngineTools } from "./engines.js"
import { registerUserProfileTools } from "./user-profile.js"
import {
  createEngineRegistry,
  UnknownEngineError,
  type EngineEntry,
  type EngineRegistry,
} from "../lib/resolve-engine.js"
import { CAMUNDA7_MODULE_KEY } from "../lib/profile-schema.js"
import {
  CAMUNDA7_LIST_ENGINES,
  CAMUNDA7_SAVE_SETTINGS,
  CAMUNDA7_SELECT_ENGINE,
} from "../tool-names.js"

const ENGINES = [
  { id: "alpha", baseUrl: "http://alpha/engine-rest", cockpitUrl: "http://alpha/cockpit" },
  { id: "beta", baseUrl: "http://beta/engine-rest" },
]

type Handler = (
  reg: EngineRegistry,
  args: Record<string, unknown>,
  ctx?: unknown,
) => Promise<Record<string, unknown>>

/** Toolset mechanics are `lib/toolsets.test.ts`'s; this pins the handler contract. */
function harness(
  store: ProfileStore = createInMemoryProfileStore(),
  engines: EngineEntry[] = ENGINES,
) {
  const registry = createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client)
  const configs = new Map<string, ToolConfig<EngineRegistry>>()
  const recorder = Object.assign(
    (config: ToolConfig<EngineRegistry>) => {
      configs.set(config.name, config)
    },
    { getRegisteredTools: () => [] },
  )
  registerEngineTools(recorder as never, store)
  const handlerOf = (name: string) => {
    const config = configs.get(name)
    if (!config) throw new Error(`${name} did not register`)
    return (config as unknown as { handler: Handler }).handler
  }
  const list = (ctx?: unknown) => handlerOf(CAMUNDA7_LIST_ENGINES)(registry, {}, ctx)
  const select = (engineId: string, ctx?: unknown) =>
    handlerOf(CAMUNDA7_SELECT_ENGINE)(registry, { engineId }, ctx)
  return { store, list, select, configs }
}

describe("the engine tool pair: a read and a write, no action switch", () => {
  it("camunda7_list_engines is a genuine read-only tool without input", () => {
    const config = harness().configs.get(CAMUNDA7_LIST_ENGINES)!
    expect(config.category).toBe("engines")
    expect(config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(config.inputSchema).toEqual({})
    expect(config.description).toBe(
      "List the engines available to this profile, grouped by environment (`environments` maps each " +
        "to its engine ids), plus the caller's saved default engine (`defaultEngineId`, null when none).",
    )
  })

  it("camunda7_select_engine is an explicitly non-destructive, idempotent local write", () => {
    const config = harness().configs.get(CAMUNDA7_SELECT_ENGINE)!
    expect(config.category).toBe("engines")
    expect(config.annotations).toEqual({
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(config.description).toContain("Save an engine as the caller's default")
    const schema = z.object(config.inputSchema)
    expect(schema.safeParse({ engineId: "beta" }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ engineId: "" }).success).toBe(false)
  })
})

const under = <T>(info: McpRequestInfo, fn: () => Promise<T>): Promise<T> =>
  runWithMcpRequestInfo(info, fn)
const USER = { authUserId: "user-1" }

describe("camunda7_select_engine (durable default)", () => {
  it("persists the default engine into the caller's profile slice and stamps the auth user", async () => {
    const { store, select } = harness()
    const result = await under(USER, () => select("beta"))
    expect(result).toEqual({ defaultEngineId: "beta" })

    const record = await store.get("user-1")
    expect(record?.modules?.[CAMUNDA7_MODULE_KEY]).toMatchObject({ defaultEngineId: "beta" })
    expect(record?.userId).toBe("user-1")
  })

  it("resolves the caller from the handler ctx the registrar hands it", async () => {
    const { store, select, list } = harness()
    await select("beta", { auth: { user: { id: "user-2" } } })
    expect(await store.get("user-2")).toMatchObject({
      userId: "user-2",
      modules: { [CAMUNDA7_MODULE_KEY]: { defaultEngineId: "beta" } },
    })
    expect((await list({ auth: { user: { id: "user-2" } } })).defaultEngineId).toBe("beta")
    expect((await list({ auth: { user: { id: "user-3" } } })).defaultEngineId).toBeNull()
  })

  it("merges over the raw stored slice — sibling settings survive a select", async () => {
    const { store, select } = harness()
    await store.save("user-1", {
      modules: {
        [CAMUNDA7_MODULE_KEY]: { pinnedDashboardIds: ["d1"], futureField: "kept" },
      },
    })
    await under(USER, () => select("alpha"))
    expect((await store.get("user-1"))?.modules?.[CAMUNDA7_MODULE_KEY]).toMatchObject({
      defaultEngineId: "alpha",
      pinnedDashboardIds: ["d1"],
      futureField: "kept",
    })
  })

  it("persists under the anonymous record only for an explicitly declared local caller", async () => {
    const { store, select } = harness()
    await under({ anonymousCaller: true }, () => select("beta"))
    expect((await store.get(ANONYMOUS_PROFILE_KEY))?.modules?.[CAMUNDA7_MODULE_KEY]).toMatchObject({
      defaultEngineId: "beta",
    })
  })

  it("refuses without a caller identity, pointing at the per-call override", async () => {
    const { store, select } = harness()
    // No OAuth, or no request context at all (a missing middleware install): neither is an identity.
    for (const selectWithoutIdentity of [
      () => under({}, () => select("beta")),
      () => select("beta"),
    ]) {
      await expect(selectWithoutIdentity()).rejects.toThrow(
        /No caller identity to save a default engine under.*per-call `engine` parameter/,
      )
    }
    expect(await store.get(ANONYMOUS_PROFILE_KEY)).toBeUndefined()
  })

  it("rejects an unknown engine id with the module's error contract", async () => {
    const { select } = harness()
    await expect(under(USER, () => select("gamma"))).rejects.toThrow(UnknownEngineError)
  })

  it("rejects an engine outside the profile's allowedEngineIds curation", async () => {
    const { store, select } = harness()
    await store.save("user-1", {
      modules: { [CAMUNDA7_MODULE_KEY]: { allowedEngineIds: ["alpha"] } },
    })
    await expect(under(USER, () => select("beta"))).rejects.toThrow(
      /not available for this profile/,
    )
  })
})

describe("camunda7_select_engine racing a settings save in the same slice", () => {
  it("keeps both writes: a stale pre-read of the default never reverts the select", async () => {
    // Writes land after a round-trip, so the profile save runs while the select's write is in flight.
    const inner = createInMemoryProfileStore()
    const store: ProfileStore = {
      ...inner,
      save: async (key, input, opts) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return inner.save(key, input, opts)
      },
    }
    await inner.save("user-1", { modules: { [CAMUNDA7_MODULE_KEY]: { defaultEngineId: "alpha" } } })
    const { select } = harness(store)
    const tool = vi.fn()
    const registry = { engines: [] } as unknown as EngineRegistry
    registerUserProfileTools({ tool } as unknown as MCPServer, store, registry, "operations")
    const saveProfile = tool.mock.calls.find(
      (c) => (c[0] as { name: string }).name === CAMUNDA7_SAVE_SETTINGS,
    )![1] as (params: unknown) => Promise<{ isError?: boolean }>

    const [, saved] = await under(USER, async () => {
      const selected = select("beta")
      await new Promise((resolve) => setTimeout(resolve, 1))
      return Promise.all([selected, saveProfile({ pinnedDashboardIds: ["d1"] })])
    })
    expect(saved.isError).toBeUndefined()
    expect((await store.get("user-1"))?.modules?.[CAMUNDA7_MODULE_KEY]).toEqual({
      defaultEngineId: "beta",
      pinnedDashboardIds: ["d1"],
    })
  })
})

describe("the engine tools during a profile-store outage", () => {
  /** The driver error names its host:port. */
  const down = (): ProfileStore => {
    const fail = () =>
      Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" }),
      )
    return { get: fail, save: fail, delete: fail }
  }

  it("the list still answers — every engine, no saved default — and leaks no host:port", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { list: listEngines } = harness(down())
    const list = await under(USER, () => listEngines())
    expect((list.engines as Array<{ id: string }>).map((e) => e.id)).toEqual(["alpha", "beta"])
    expect(list.defaultEngineId).toBeNull()
    expect(JSON.stringify(list)).not.toMatch(/10\.1\.2\.3|5432/)
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/10\.1\.2\.3|5432/)
    warn.mockRestore()
  })

  it("select (a durable write) still fails visibly", async () => {
    const { select } = harness(down())
    await expect(under(USER, () => select("beta"))).rejects.toThrow()
  })
})

describe("camunda7_list_engines", () => {
  it("reports null when no default is saved", async () => {
    const { list: listEngines } = harness()
    const list = await under(USER, () => listEngines())
    expect(list.defaultEngineId).toBeNull()
  })

  it("reports the default select saved", async () => {
    const { list: listEngines, select } = harness()
    await under(USER, () => select("beta"))
    const list = await under(USER, () => listEngines())
    expect(list.defaultEngineId).toBe("beta")
  })

  it("nulls a stale default that no longer names a configured engine", async () => {
    const { store, list: listEngines } = harness()
    await store.save("user-1", {
      modules: { [CAMUNDA7_MODULE_KEY]: { defaultEngineId: "gone" } },
    })
    expect((await under(USER, () => listEngines())).defaultEngineId).toBeNull()
  })

  it("nulls a default excluded by the allowedEngineIds curation and filters the list", async () => {
    const { store, list: listEngines } = harness()
    await store.save("user-1", {
      modules: {
        [CAMUNDA7_MODULE_KEY]: { defaultEngineId: "beta", allowedEngineIds: ["alpha"] },
      },
    })
    const list = await under(USER, () => listEngines())
    expect((list.engines as Array<{ id: string }>).map((e) => e.id)).toEqual(["alpha"])
    expect(list.defaultEngineId).toBeNull()
  })

  it("falls back to all engines when the allow-list matches nothing (stale curation)", async () => {
    const { store, list: listEngines } = harness()
    await store.save("user-1", {
      modules: { [CAMUNDA7_MODULE_KEY]: { allowedEngineIds: ["gone"] } },
    })
    const list = await under(USER, () => listEngines())
    expect((list.engines as Array<{ id: string }>).map((e) => e.id)).toEqual(["alpha", "beta"])
  })

  it("never hands the model an engine's internal REST baseUrl — only a configured cockpitUrl", async () => {
    const { list: listEngines } = harness()
    const list = await under(USER, () => listEngines())
    expect(list.engines).toEqual([
      expect.objectContaining({ id: "alpha", cockpitUrl: "http://alpha/cockpit" }),
      expect.objectContaining({ id: "beta" }),
    ])
    for (const engine of list.engines as Array<Record<string, unknown>>) {
      expect(engine).not.toHaveProperty("baseUrl")
    }
    expect(JSON.stringify(list)).not.toContain("engine-rest")
  })

  it("groups an environment-less config into the single default environment", async () => {
    const { list: listEngines } = harness()
    const list = await under(USER, () => listEngines())
    expect((list.engines as Array<{ environment: string }>).map((e) => e.environment)).toEqual([
      "default",
      "default",
    ])
    expect(list.environments).toEqual([{ id: "default", engineIds: ["alpha", "beta"] }])
  })

  it("maps environments to their engines in config order — the two-stage selection view", async () => {
    const { list: listEngines } = harness(createInMemoryProfileStore(), [
      { id: "eu-a", baseUrl: "http://eu-a/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a/engine-rest", environment: "prod-us" },
      { id: "eu-b", baseUrl: "http://eu-b/engine-rest", environment: "prod-eu" },
    ])
    const list = await under(USER, () => listEngines())
    expect(
      (list.engines as Array<{ id: string; environment: string }>).map((e) => [
        e.id,
        e.environment,
      ]),
    ).toEqual([
      ["eu-a", "prod-eu"],
      ["us-a", "prod-us"],
      ["eu-b", "prod-eu"],
    ])
    expect(list.environments).toEqual([
      { id: "prod-eu", engineIds: ["eu-a", "eu-b"] },
      { id: "prod-us", engineIds: ["us-a"] },
    ])
  })
})
