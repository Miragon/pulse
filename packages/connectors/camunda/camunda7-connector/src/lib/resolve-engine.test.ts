import { describe, it, expect, vi } from "vitest"
import type { Client } from "@miragon/pulse-camunda7-client"
import {
  createEngineRegistry,
  resolveEngine,
  EngineNotSelectedError,
  UnknownEngineError,
} from "./resolve-engine.js"

const engineIdOf = (client: Client): string => (client as unknown as { __engine: string }).__engine

const SINGLE = [
  { id: "default", baseUrl: "http://e1/engine-rest", cockpitUrl: "http://e1/cockpit" },
]
const MULTI = [
  { id: "alpha", baseUrl: "http://alpha/engine-rest", cockpitUrl: "http://alpha/cockpit" },
  { id: "beta", baseUrl: "http://beta/engine-rest" },
]

// Profile plumbing is covered via the engines-tool tests; here: override > saved default > single engine.
function harness(
  engines: Array<{ id: string; baseUrl: string; cockpitUrl?: string }>,
  defaultEngineId?: () => Promise<string | undefined>,
) {
  return createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client, {
    defaultEngineId,
  })
}

describe("resolveEngine", () => {
  it("resolves the only engine (with its baseUrl) when one is configured and no default is saved", async () => {
    const { client, engineId, baseUrl, cockpitUrl } = await resolveEngine(
      undefined,
      harness(SINGLE),
    )
    expect(engineId).toBe("default")
    expect(engineIdOf(client)).toBe("default")
    expect(baseUrl).toBe("http://e1/engine-rest")
    expect(cockpitUrl).toBe("http://e1/cockpit")
  })

  it("honours the saved default engine in a multi-engine setup", async () => {
    const registry = harness(MULTI, () => Promise.resolve("beta"))
    const { client, engineId, baseUrl } = await resolveEngine(undefined, registry)
    expect(engineId).toBe("beta")
    expect(engineIdOf(client)).toBe("beta")
    expect(baseUrl).toBe("http://beta/engine-rest")
  })

  it("lets an explicit override win over the saved default", async () => {
    const lookup = vi.fn(() => Promise.resolve("beta"))
    const { client, engineId, cockpitUrl } = await resolveEngine("alpha", harness(MULTI, lookup))
    expect(engineId).toBe("alpha")
    expect(engineIdOf(client)).toBe("alpha")
    expect(cockpitUrl).toBe("http://alpha/cockpit")
    // An override must not even consult the profile (a per-call store read).
    expect(lookup).not.toHaveBeenCalled()
  })

  it("throws a clear EngineNotSelectedError for multi-engine with no default and no override", async () => {
    const registry = harness(MULTI)
    await expect(resolveEngine(undefined, registry)).rejects.toThrow(EngineNotSelectedError)
    // Only code + message reach the model, so the ids must be named; no save hint without `canSaveDefault`.
    await expect(resolveEngine(undefined, registry)).rejects.toThrow(
      "No engine specified and no default engine saved. Pass `engine` — one of: alpha, beta.",
    )
  })

  it("points at camunda7_select_engine only when the registry says the caller can save", async () => {
    const registry = createEngineRegistry(MULTI, (e) => ({ __engine: e.id }) as unknown as Client, {
      canSaveDefault: () => true,
    })
    await expect(resolveEngine(undefined, registry)).rejects.toThrow(
      "No engine specified and no default engine saved. Pass `engine` — one of: alpha, beta. " +
        "To route later calls without it, save a default with camunda7_select_engine.",
    )
  })

  it("throws UnknownEngineError when the override names a non-existent engine", async () => {
    await expect(resolveEngine("gamma", harness(MULTI))).rejects.toThrow(UnknownEngineError)
  })

  it("reads an empty override as none: the only engine answers", async () => {
    const { engineId } = await resolveEngine("", harness(SINGLE))
    expect(engineId).toBe("default")
  })
})

describe("createEngineRegistry", () => {
  const clientFor = (e: { id: string }) => ({ __engine: e.id }) as unknown as Client

  // Programmer errors fail the boot, not the first tool call.
  it("refuses an empty engine list", () => {
    expect(() => createEngineRegistry([], clientFor)).toThrow(
      "createEngineRegistry needs at least one engine",
    )
  })

  it("refuses a duplicate engine id", () => {
    expect(() => createEngineRegistry([...MULTI, MULTI[0]], clientFor)).toThrow(
      'createEngineRegistry: duplicate engine id "alpha"',
    )
  })

  it("keeps the engines in configuration order", () => {
    expect([...createEngineRegistry(MULTI, clientFor).backends.keys()]).toEqual(["alpha", "beta"])
  })
})

describe("saved-default validation", () => {
  // A removed engine degrades to "no default", never fails every call with UnknownEngineError.
  it("ignores a stale saved default that names a no-longer-configured engine", async () => {
    const registry = harness(MULTI, () => Promise.resolve("gone"))
    await expect(resolveEngine(undefined, registry)).rejects.toThrow(EngineNotSelectedError)
  })

  it("falls back to the sole configured engine when the saved default is stale", async () => {
    const registry = harness(SINGLE, () => Promise.resolve("gone"))
    const { engineId } = await resolveEngine(undefined, registry)
    expect(engineId).toBe("default")
  })

  it("resolves without any default lookup wired (tests, minimal registries)", async () => {
    const registry = createEngineRegistry(SINGLE, (e) => ({ __engine: e.id }) as unknown as Client)
    const { engineId } = await resolveEngine(undefined, registry)
    expect(engineId).toBe("default")
  })
})
