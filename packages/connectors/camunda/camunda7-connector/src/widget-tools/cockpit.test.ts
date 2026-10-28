import { describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import type { Client } from "@miragon/pulse-camunda7-client"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import { DEFAULT_HEALTH_THRESHOLDS } from "../data/health-data.js"
import { profileDefaultEngineId } from "../lib/engine-preferences.js"
import { createEngineRegistry, type EngineEntry } from "../lib/resolve-engine.js"
import { CAMUNDA7_OPEN_COCKPIT } from "../tool-names.js"
import { engineParamShape } from "../lib/with-engine.js"
import { registerCockpitWidgetTools } from "./cockpit.js"

interface CockpitResult {
  isError?: boolean
  structuredContent?: { context: { stepData: { result: { data: Record<string, unknown> } } } }
  content: Array<{ type: string; text: string }>
}

type Handler = (args: Record<string, unknown>, ctx?: unknown) => Promise<CockpitResult>

function openCockpit(
  engines: EngineEntry[],
  profileStore: ProfileStore = createInMemoryProfileStore(),
): Handler {
  const tool = vi.fn()
  registerCockpitWidgetTools({
    server: { tool } as unknown as MCPServer,
    registry: createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client, {
      defaultEngineId: (call) => profileDefaultEngineId(profileStore, engines, call),
    }),
    healthThresholds: DEFAULT_HEALTH_THRESHOLDS,
    profileStore,
    toolset: "read-only",
    modelTools: () => [],
    engineParam: engineParamShape,
  })
  const call = tool.mock.calls.find(
    ([definition]) => (definition as { name: string }).name === CAMUNDA7_OPEN_COCKPIT,
  )
  expect(call).toBeDefined()
  return call![1] as Handler
}

const dataOf = (result: CockpitResult) => result.structuredContent!.context.stepData.result.data
const textOf = (result: CockpitResult) => result.content.map((c) => c.text).join("\n")

const callAs = (id: string) => ({ auth: { user: { id } } })

const THREE: EngineEntry[] = [
  { id: "alpha", baseUrl: "http://alpha.internal/engine-rest" },
  { id: "beta", baseUrl: "http://beta.internal/engine-rest" },
  { id: "gamma", baseUrl: "http://gamma.internal/engine-rest" },
]
const ALL = THREE.map((e) => ({ id: e.id, environment: "default" }))

async function storeWith(settings: Record<string, unknown>): Promise<ProfileStore> {
  const store = createInMemoryProfileStore()
  await store.save("user-1", { modules: { camunda7: settings } })
  return store
}

describe("camunda7_open_cockpit — the cockpit bootstrap", () => {
  it("hands the app each engine's id and environment — never its internal REST baseUrl", async () => {
    const handler = openCockpit([
      { id: "alpha", baseUrl: "http://alpha.internal:8410/engine-rest", environment: "prod" },
      { id: "beta", baseUrl: "http://beta.internal:8410/engine-rest" },
    ])
    const result = await handler({})
    const data = dataOf(result)
    expect(data).toEqual({
      engineId: null,
      engines: [
        { id: "alpha", environment: "prod" },
        { id: "beta", environment: "default" },
      ],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("engine-rest")
    expect(serialized).not.toContain(".internal")
  })

  it("lands on the only engine when exactly one is configured", async () => {
    const handler = openCockpit([{ id: "solo", baseUrl: "http://solo.internal/engine-rest" }])
    const data = dataOf(await handler({}))
    expect(data).toEqual({ engineId: "solo", engines: [{ id: "solo", environment: "default" }] })
  })
})

/** #341: the summary never names an engine the user is not looking at. */
describe("camunda7_open_cockpit — the engine it opens on", () => {
  it("honours the `engine` argument", async () => {
    const result = await openCockpit(THREE)({ engine: "beta" })
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toEqual({ engineId: "beta", engines: ALL })
    expect(textOf(result)).toContain('cockpit for engine "beta"')
  })

  it("an unknown `engine` is a tool error — never a silent picker", async () => {
    const result = await openCockpit(THREE)({ engine: "delta" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      '[UNKNOWN_ENGINE] Unknown engine id "delta". Available: alpha, beta, gamma.',
    )
  })

  it("opens on the caller's saved default", async () => {
    const handler = openCockpit(THREE, await storeWith({ defaultEngineId: "gamma" }))
    const result = await handler({}, callAs("user-1"))
    expect(dataOf(result)).toMatchObject({ engineId: "gamma" })
    expect(textOf(result)).toContain('cockpit for engine "gamma"')
    expect(dataOf(await handler({}, callAs("user-2")))).toMatchObject({ engineId: null })
  })

  it("an explicit `engine` beats the saved default", async () => {
    const handler = openCockpit(THREE, await storeWith({ defaultEngineId: "gamma" }))
    expect(dataOf(await handler({ engine: "alpha" }, callAs("user-1")))).toMatchObject({
      engineId: "alpha",
    })
  })

  it("several engines, no default: the picker, and the summary says so", async () => {
    const result = await openCockpit(THREE)({})
    expect(dataOf(result)).toEqual({ engineId: null, engines: ALL })
    expect(textOf(result)).toContain("engine picker")
    expect(textOf(result)).not.toMatch(/for engine "/)
  })

  it("lists the caller's curated engines — the same list camunda7_list_engines returns", async () => {
    const handler = openCockpit(THREE, await storeWith({ allowedEngineIds: ["alpha", "gamma"] }))
    const data = dataOf(await handler({}, callAs("user-1")))
    expect(data).toEqual({
      engineId: null,
      engines: [
        { id: "alpha", environment: "default" },
        { id: "gamma", environment: "default" },
      ],
    })
  })

  it("one engine left in the caller's list: opens on it", async () => {
    const handler = openCockpit(THREE, await storeWith({ allowedEngineIds: ["beta"] }))
    const result = await handler({}, callAs("user-1"))
    expect(dataOf(result)).toEqual({
      engineId: "beta",
      engines: [{ id: "beta", environment: "default" }],
    })
  })

  it("an `engine` curated out of the caller's list is a tool error naming the list", async () => {
    const handler = openCockpit(THREE, await storeWith({ allowedEngineIds: ["alpha", "gamma"] }))
    const result = await handler({ engine: "beta" }, callAs("user-1"))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      '[ENGINE_NOT_AVAILABLE] Engine "beta" is not in this user\'s engine list (allowedEngineIds) — ' +
        "the cockpit offers: alpha, gamma. Open it on one of those, or pass `engine` to the camunda7 tools directly.",
    )
  })

  it("a preferences-store outage degrades to the full list and the picker — never an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const down = () => Promise.reject(new Error("connect ECONNREFUSED 10.1.2.3:5432"))
    const store = { get: vi.fn(down), save: down, delete: down } as unknown as ProfileStore
    const result = await openCockpit(THREE, store)({}, callAs("user-1"))
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toEqual({ engineId: null, engines: ALL })
    vi.restoreAllMocks()
  })
})
