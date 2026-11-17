import { describe, it, expect, vi } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import type { EngineEntry } from "../../engine-provider.js"
import { runtimeOf } from "./engine-runtime.js"
import {
  createEngineRegistry,
  resolveEngine,
  resolveRuntimeEngine,
  type ContractRuntime,
  EngineDialectNotServedError,
  EngineNotSelectedError,
  EngineProfileRefusedError,
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

// Override > the operator default (`ENGINE_DEFAULT`) > the only engine.
function harness(
  engines: Array<{ id: string; baseUrl: string; cockpitUrl?: string }>,
  defaultEngineId?: string,
) {
  return createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client, {
    defaultEngineId,
  })
}

describe("resolveEngine", () => {
  it("resolves the only engine (with its baseUrl) when one is configured and no default is set", () => {
    const { client, engineId, baseUrl, cockpitUrl } = resolveEngine(undefined, harness(SINGLE))
    expect(engineId).toBe("default")
    expect(engineIdOf(client)).toBe("default")
    expect(baseUrl).toBe("http://e1/engine-rest")
    expect(cockpitUrl).toBe("http://e1/cockpit")
  })

  it("routes to the default engine in a multi-engine setup", () => {
    const registry = harness(MULTI, "beta")
    const { client, engineId, baseUrl } = resolveEngine(undefined, registry)
    expect(engineId).toBe("beta")
    expect(engineIdOf(client)).toBe("beta")
    expect(baseUrl).toBe("http://beta/engine-rest")
  })

  it("lets an explicit override win over the default engine", () => {
    const { client, engineId, cockpitUrl } = resolveEngine("alpha", harness(MULTI, "beta"))
    expect(engineId).toBe("alpha")
    expect(engineIdOf(client)).toBe("alpha")
    expect(cockpitUrl).toBe("http://alpha/cockpit")
  })

  it("throws a clear EngineNotSelectedError for multi-engine with no default and no override", () => {
    const registry = harness(MULTI)
    expect(() => resolveEngine(undefined, registry)).toThrow(EngineNotSelectedError)
    // Only code + message reach the model, so the ids must be named.
    expect(() => resolveEngine(undefined, registry)).toThrow(
      "No engine specified and no default engine configured. Pass `engine`, one of: alpha, beta.",
    )
  })

  it("throws UnknownEngineError when the override names a non-existent engine", () => {
    expect(() => resolveEngine("gamma", harness(MULTI))).toThrow(UnknownEngineError)
  })

  it("reads an empty override as none: the only engine answers", () => {
    const { engineId } = resolveEngine("", harness(SINGLE))
    expect(engineId).toBe("default")
  })

  it("an empty override still skips the default engine", () => {
    expect(() => resolveEngine("", harness(MULTI, "beta"))).toThrow(EngineNotSelectedError)
  })

  it("resolves the only engine without any default wired (tests, minimal registries)", () => {
    const registry = createEngineRegistry(SINGLE, (e) => ({ __engine: e.id }) as unknown as Client)
    const { engineId } = resolveEngine(undefined, registry)
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

/** A profile the server refused: in the enum and the count, never a backend; a call says why. */
describe("a refused profile in the registry", () => {
  const client = (e: { id: string }) => ({ __engine: e.id }) as unknown as Client
  const REFUSED = { id: "locked", reason: "auth.tokenEnv is missing." }
  const registry = (defaultEngineId?: string) =>
    createEngineRegistry([MULTI[0], { ...MULTI[1], readOnly: true }], client, {
      refused: [REFUSED],
      defaultEngineId,
    })

  it("counts it with the engines and names it after them by default", () => {
    const { engineIds, profileCount, refused } = registry()
    expect([engineIds, profileCount, [...refused.keys()]]).toEqual([
      ["alpha", "beta", "locked"],
      3,
      ["locked"],
    ])
  })

  it("never routes to it: a call naming it, or a default on it, fails with its reason", () => {
    expect(() => resolveEngine("locked", registry())).toThrow(EngineProfileRefusedError)
    expect(() => resolveEngine(undefined, registry("locked"))).toThrow(
      'Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv is missing. Ask whoever runs this server to fix it.',
    )
  })

  it("one usable and one refused profile: no default, so a call without engine is not selected", () => {
    const pair = createEngineRegistry([MULTI[0]], client, { refused: [REFUSED] })
    expect(() => resolveEngine(undefined, pair)).toThrow(EngineNotSelectedError)
  })
})

/**
 * An engine of another dialect: a contract backend over engine-core's fake, its runtime factory a
 * spy. Every Camunda 7 path refuses it before anything is built or sent, never rerouted;
 * `resolveRuntimeEngine` serves it through its runtime.
 */
describe("an engine of another dialect in the registry", () => {
  const client = (e: { id: string }) => ({ __engine: e.id }) as unknown as Client
  const C8 = { id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" as const }
  const REFUSED = { id: "locked", reason: "auth.tokenEnv is missing." }

  function contractRegistry(
    opts: { boards?: readonly string[]; defaultEngineId?: string; only?: boolean } = {},
  ) {
    const runtime = vi.fn<ContractRuntime>(() => new FakeEngine(FakeWorld.seed().state))
    const contractRuntime = vi.fn<(engine: EngineEntry) => ContractRuntime>(() => runtime)
    const registry = createEngineRegistry(opts.only ? [C8] : [MULTI[0], C8], client, {
      contractRuntime,
      boardsNaming: (id) => (id === "c8" ? (opts.boards ?? []) : []),
      ...(opts.only ? {} : { refused: [REFUSED] }),
      defaultEngineId: opts.defaultEngineId,
    })
    return { registry, runtime, contractRuntime }
  }

  const SENT =
    'Engine "c8" is a Camunda 8 engine, and this tool or view reads the Camunda 7 REST API (Camunda 7, CIB seven, Operaton), so nothing was sent.'
  const ON_BOARDS = `${SENT} This server reads a Camunda 8 engine on boards only: engine_list_engines lists the boards that name it, and engine_open_cockpit with view board shows one.`
  const ON_NO_BOARD = `${SENT} This server reads a Camunda 8 engine on boards only, and no board names "c8" yet; the server's operator adds one.`

  it("builds its runtime factory at boot, with the boards that name it, and no client", () => {
    const { registry, contractRuntime } = contractRegistry({ boards: ["orders"] })
    expect(contractRuntime.mock.calls.map(([engine]) => engine.id)).toEqual(["c8"])
    expect(registry.backends.get("c8")).toMatchObject({
      dialect: "c8",
      readOnly: true,
      boards: ["orders"],
      provider: { flavor: "camunda8", dialect: "c8" },
    })
    expect(registry.backends.get("c8")).not.toHaveProperty("client")
  })

  it("fails the boot when no runtime is handed in for it", () => {
    expect(() => createEngineRegistry([MULTI[0], C8], client)).toThrow(
      'createEngineRegistry: engine "c8" speaks c8, and no runtime for it was handed in',
    )
  })

  it.each([
    ["a board names it", ["orders"], ON_BOARDS],
    ["no board names it", [], ON_NO_BOARD],
  ])("refuses every Camunda 7 path when %s, and never builds its runtime", (_, boards, text) => {
    const { registry, runtime } = contractRegistry({ boards })
    const refusals = [
      () => resolveEngine("c8", registry),
      () => resolveEngine(undefined, contractRegistry({ boards, defaultEngineId: "c8" }).registry),
    ]
    for (const refusal of refusals) {
      expect(refusal).toThrow(EngineDialectNotServedError)
      expect(refusal).toThrow(text)
    }
    expect(() => resolveEngine("c8", registry)).toThrow(
      expect.objectContaining({ code: "ENGINE_DIALECT_NOT_SERVED", engineId: "c8" }),
    )
    expect(runtime).not.toHaveBeenCalled()
  })

  it("never reroutes: a refused profile and an unknown id fail as before, the others still resolve", () => {
    const { registry } = contractRegistry()
    expect(resolveEngine("alpha", registry).engineId).toBe("alpha")
    expect(() => resolveEngine("locked", registry)).toThrow(EngineProfileRefusedError)
    expect(() => resolveRuntimeEngine("locked", registry)).toThrow(EngineProfileRefusedError)
    expect(() => resolveRuntimeEngine("gamma", registry)).toThrow(UnknownEngineError)
  })

  it("resolveRuntimeEngine gives its runtime, bound to the caller's signal", async () => {
    const { registry, runtime } = contractRegistry()
    const signal = new AbortController().signal
    const engine = resolveRuntimeEngine("c8", registry, { mcpReq: { signal } })
    expect(engine).toMatchObject({ dialect: "c8", engineId: "c8", signal })
    expect(runtime).not.toHaveBeenCalled()
    expect(await runtimeOf(engine).describeEngine()).toEqual(FakeWorld.seed().state.engine)
    expect(runtime).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it("resolveRuntimeEngine gives a Camunda 7 engine as resolveEngine does", () => {
    const { registry } = contractRegistry()
    const engine = resolveRuntimeEngine("alpha", registry)
    expect(engine).toEqual(resolveEngine("alpha", registry))
    expect("client" in engine && engineIdOf(engine.client)).toBe("alpha")
  })

  it("counts it in the engine enum and lists it when no engine is selected", () => {
    const { registry } = contractRegistry()
    expect(registry.engineIds).toEqual(["alpha", "c8", "locked"])
    expect(() => resolveRuntimeEngine(undefined, registry)).toThrow(
      "No engine specified and no default engine configured. Pass `engine`, one of: alpha, c8.",
    )
  })

  it("as the only engine it is the default: served through its runtime, refused on a Camunda 7 path", () => {
    const { registry } = contractRegistry({ only: true })
    expect(resolveRuntimeEngine(undefined, registry)).toMatchObject({ engineId: "c8" })
    expect(() => resolveEngine(undefined, registry)).toThrow(ON_NO_BOARD)
  })
})
