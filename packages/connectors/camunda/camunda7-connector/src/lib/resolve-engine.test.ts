import { describe, it, expect } from "vitest"
import type { Client } from "@miragon/pulse-camunda7-client"
import {
  cockpitEngineId,
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

// Override > the operator default (`CAMUNDA_DEFAULT_ENGINE`) > the only engine.
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
