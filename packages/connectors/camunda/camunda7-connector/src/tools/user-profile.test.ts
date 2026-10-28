import { afterEach, describe, expect, it, vi } from "vitest"
import { feedPayload } from "./test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { registerUserProfileTools } from "./user-profile.js"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { resolveCamunda7Toolset, type Camunda7Toolset } from "../lib/toolsets.js"
import {
  CAMUNDA7_SAVE_SETTINGS,
  CAMUNDA7_SHOW_SETTINGS,
  CAMUNDA7_SETTINGS_DATA,
} from "../tool-names.js"

afterEach(() => {
  vi.restoreAllMocks()
})

/** A signed-in caller's handler ctx (mcp-use's flattened `ctx.auth`). */
const CTX = { auth: { user: { id: "user-1" } } }

type Handler = (
  params: unknown,
  ctx?: unknown,
) => Promise<{
  structuredContent?: Record<string, unknown>
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}>

/**
 * Register the triple against a mock server and expose what landed on it. The
 * toolset is always explicit; the default is `operations`, an authenticated
 * boot's no-suffix toolset (profile writes allowed).
 */
function register(
  toolset: Camunda7Toolset = "operations",
  registry = { engines: [] } as unknown as EngineRegistry,
  store: ProfileStore = createInMemoryProfileStore(),
) {
  const tool = vi.fn()
  const server = { tool } as unknown as MCPServer
  registerUserProfileTools(server, store, registry, toolset)
  const names = tool.mock.calls.map((c) => (c[0] as { name: string }).name)
  const definitionFor = (name: string): Record<string, unknown> => {
    const call = tool.mock.calls.find((c) => (c[0] as { name: string }).name === name)
    if (!call) throw new Error(`tool ${name} not registered`)
    return call[0] as Record<string, unknown>
  }
  const handlerFor = (name: string): Handler => {
    const call = tool.mock.calls.find((c) => (c[0] as { name: string }).name === name)
    if (!call) throw new Error(`tool ${name} not registered`)
    return call[1] as Handler
  }
  return { names, definitionFor, handlerFor }
}

const registeredToolNames = (toolset: Camunda7Toolset): string[] => register(toolset).names

describe("registerUserProfileTools toolset filtering", () => {
  it("registers all three tools under operations", () => {
    expect(registeredToolNames("operations")).toEqual([
      CAMUNDA7_SHOW_SETTINGS,
      CAMUNDA7_SETTINGS_DATA,
      CAMUNDA7_SAVE_SETTINGS,
    ])
  })

  it("keeps the durable save tool out of a read-only deployment", () => {
    const names = registeredToolNames("read-only")
    expect(names).toContain(CAMUNDA7_SHOW_SETTINGS)
    expect(names).toContain(CAMUNDA7_SETTINGS_DATA)
    expect(names).not.toContain(CAMUNDA7_SAVE_SETTINGS)
  })

  it("keeps save in operations and admin", () => {
    expect(registeredToolNames("operations")).toContain(CAMUNDA7_SAVE_SETTINGS)
    expect(registeredToolNames("admin")).toContain(CAMUNDA7_SAVE_SETTINGS)
  })

  it("fails closed for unknown and missing names, resolved like the plugin does", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(registeredToolNames(resolveCamunda7Toolset("nonsense"))).not.toContain(
      CAMUNDA7_SAVE_SETTINGS,
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "nonsense"'))
    expect(registeredToolNames(resolveCamunda7Toolset(undefined))).not.toContain(
      CAMUNDA7_SAVE_SETTINGS,
    )
  })

  it("names the toolset as the reason a signed-in caller cannot save", async () => {
    const result = await register("read-only").handlerFor(CAMUNDA7_SETTINGS_DATA)({}, CTX)
    expect(feedPayload(result)).toMatchObject({ canSave: false, readOnlyReason: "toolset" })
  })
})

describe("engine disclosure (#324)", () => {
  it("offers engines by id and environment — never the internal engine REST baseUrl", async () => {
    const registry = {
      engines: [
        { id: "prod-a", baseUrl: "http://engine-a.internal:8410/engine-rest" },
        { id: "prod-b", baseUrl: "http://engine-b.internal:8410/engine-rest", environment: "eu" },
      ],
    } as unknown as EngineRegistry
    const result = await register("operations", registry).handlerFor(CAMUNDA7_SETTINGS_DATA)({})
    expect(feedPayload(result).availableEngines).toEqual([
      { id: "prod-a", environment: "default" },
      { id: "prod-b", environment: "eu" },
    ])
    expect(JSON.stringify(result)).not.toContain(".internal")
  })
})

describe("caller round-trip", () => {
  it("reads the caller's save back on the next load — and only the caller's", async () => {
    const { handlerFor } = register()

    // The save and the read resolve the SAME record from the handler ctx.
    await handlerFor(CAMUNDA7_SAVE_SETTINGS)({ defaultEngineId: "prod-b" }, CTX)
    const result = await handlerFor(CAMUNDA7_SETTINGS_DATA)({}, CTX)
    const profile = feedPayload(result).profile as { defaultEngineId?: string } | undefined
    expect(profile?.defaultEngineId).toBe("prod-b")

    const other = await handlerFor(CAMUNDA7_SETTINGS_DATA)({}, { auth: { user: { id: "u-2" } } })
    // Another caller sees the default: no default engine.
    expect(
      (feedPayload(other).profile as { defaultEngineId?: string }).defaultEngineId,
    ).toBeUndefined()
  })

  it("an explicitly declared local caller round-trips through the anonymous record", async () => {
    const store = createInMemoryProfileStore()
    const { handlerFor } = register("operations", undefined, store)
    const local = <T>(fn: () => T): T => runWithMcpRequestInfo({ anonymousCaller: true }, fn)
    await local(() => handlerFor(CAMUNDA7_SAVE_SETTINGS)({ defaultEngineId: "prod-b" }))
    const result = await local(() => handlerFor(CAMUNDA7_SETTINGS_DATA)({}))
    expect(feedPayload(result).canSave).toBe(true)
    expect((await store.get("anonymous"))?.modules?.camunda7).toMatchObject({
      defaultEngineId: "prod-b",
    })
  })

  // #346: the language is the shell's — this module reads it to word its
  // summary and title, and never saves it.
  it("summarizes in the language the record names, which the shell saves", async () => {
    const store = createInMemoryProfileStore()
    const { handlerFor, definitionFor } = register("operations", undefined, store)
    const saveInput = definitionFor(CAMUNDA7_SAVE_SETTINGS).inputSchema as { shape: object }
    expect(Object.keys(saveInput.shape)).not.toContain("language")

    // Following the host's locale, which never reaches the server: English.
    const system = await handlerFor(CAMUNDA7_SHOW_SETTINGS)({}, CTX)
    expect(system.content?.[0]?.text).toBe("camunda7 settings: all engines.")
    expect(JSON.stringify(system.structuredContent)).not.toContain('"language"')

    await store.save("user-1", { language: "de" })
    const german = await handlerFor(CAMUNDA7_SHOW_SETTINGS)({}, CTX)
    expect(german.content?.[0]?.text).toBe("camunda7-Einstellungen: alle Engines.")
  })
})

/**
 * The settings page sends "" for the "(auto)" default engine and the "(none)"
 * default dashboard. That must CLEAR the stored value: a stale default keeps
 * routing every engine-less tool call (writes included) to the old engine.
 */
describe("clearing an optional id from the settings page", () => {
  it('"" clears the saved default engine and default dashboard, other fields stay', async () => {
    const store = createInMemoryProfileStore()
    const { handlerFor } = register("operations", undefined, store)
    const save = (params: unknown) => handlerFor(CAMUNDA7_SAVE_SETTINGS)(params, CTX)
    await save({ defaultEngineId: "prod-a", defaultDashboardId: "d1", pinnedDashboardIds: ["d1"] })

    const cleared = await save({ defaultEngineId: "", defaultDashboardId: "" })
    expect(feedPayload(cleared).defaultEngineId).toBeUndefined()
    expect(feedPayload(cleared).defaultDashboardId).toBeUndefined()
    expect(feedPayload(cleared).pinnedDashboardIds).toEqual(["d1"])

    const view = await handlerFor(CAMUNDA7_SETTINGS_DATA)({}, CTX)
    const profile = feedPayload(view).profile as Record<string, unknown>
    expect(profile.defaultEngineId).toBeUndefined()
    expect(profile.defaultDashboardId).toBeUndefined()
    expect((await store.get("user-1"))?.modules?.camunda7).toEqual({
      pinnedDashboardIds: ["d1"],
    })
  })
})
