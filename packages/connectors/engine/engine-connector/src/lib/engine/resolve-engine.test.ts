import { describe, it, expect } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import {
  assertWritable,
  cockpitEngineId,
  createEngineRegistry,
  resolveEngine,
  EngineNotSelectedError,
  EngineProfileRefusedError,
  EngineReadOnlyError,
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

// Tool-level cases live in `widget-tools/cockpit.test.ts`; these pin the error contract (#341).
describe("cockpitEngineId", () => {
  it("opens on the override", () => {
    expect(cockpitEngineId("beta", harness(MULTI))).toBe("beta")
  })

  it("opens on the default engine without an override", () => {
    expect(cockpitEngineId(undefined, harness(MULTI, "beta"))).toBe("beta")
  })

  it("answers null (the picker) when several engines and no default leave nothing selected", () => {
    expect(cockpitEngineId(undefined, harness(MULTI))).toBeNull()
  })

  it("rejects an unknown engine instead of opening the picker", () => {
    expect(() => cockpitEngineId("gamma", harness(MULTI))).toThrow(UnknownEngineError)
  })

  it("only 'no engine selected' falls back to the picker: any other failure propagates", () => {
    // The config schema refuses such a default; a registry built around it still never opens the picker.
    const broken = harness(MULTI, "gone")
    expect(() => cockpitEngineId(undefined, broken)).toThrow(UnknownEngineError)
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
      'Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv is missing. Ask the operator to fix it.',
    )
  })

  it("one usable and one refused profile: no default, so a call without engine is not selected", () => {
    const pair = createEngineRegistry([MULTI[0]], client, { refused: [REFUSED] })
    expect(() => resolveEngine(undefined, pair)).toThrow(EngineNotSelectedError)
    expect(cockpitEngineId(undefined, pair)).toBeNull()
  })

  it("the cockpit opens the picker on it instead of failing", () => {
    expect(cockpitEngineId("locked", registry())).toBeNull()
    expect(cockpitEngineId(undefined, registry("locked"))).toBeNull()
  })

  it("assertWritable refuses a write to a read-only engine and lets the others through", () => {
    expect(() => assertWritable("beta", registry())).toThrow(EngineReadOnlyError)
    expect(() => assertWritable("beta", registry())).toThrow(
      'Engine "beta" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.',
    )
    expect(() => assertWritable("alpha", registry())).not.toThrow()
    expect(() => assertWritable("locked", registry())).toThrow(EngineProfileRefusedError)
  })
})
