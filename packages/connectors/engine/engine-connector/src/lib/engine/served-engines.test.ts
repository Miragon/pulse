import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { Client } from "@miragon/pulse-c7-client"
import type { ToolConfig, ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import {
  type ContractRuntime,
  createEngineRegistry,
  EngineDialectNotServedError,
  EngineNotSelectedError,
  EngineProfileRefusedError,
  EngineReadOnlyError,
  type EngineRegistry,
  UnknownEngineError,
} from "./resolve-engine.js"
import {
  cockpitEngineId,
  engineServing,
  type EngineToolConfig,
  offeredEngineIds,
  servedEngineIds,
  withServedEngines,
} from "./served-engines.js"
import { engineParamShape } from "./with-engine.js"

const client = (e: { id: string }) => ({ __engine: e.id }) as unknown as Client

const C7 = { dialects: ["c7"] } as const
const EVERY = { dialects: ["c7", "c8"] } as const
const C7_WRITE = { dialects: ["c7"], write: true } as const

/**
 * Camunda 7 engines `alpha` (writable) and `beta` (read-only), the Camunda 8 engine `c8`, and
 * three refused profiles in between: one of each dialect and one the parser read no dialect of.
 */
function mixed(opts: { defaultEngineId?: string; boards?: readonly string[] } = {}) {
  const runtime = vi.fn<ContractRuntime>(() => new FakeEngine(FakeWorld.seed().state))
  const registry = createEngineRegistry(
    [
      { id: "alpha", baseUrl: "http://alpha/engine-rest" },
      { id: "beta", baseUrl: "http://beta/engine-rest", readOnly: true },
      { id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" },
    ],
    client,
    {
      refused: [
        { id: "old-c7", dialect: "c7", reason: "auth.tokenEnv is missing." },
        { id: "old-c8", dialect: "c8", reason: "auth.clientSecretEnv is missing." },
        { id: "unread", reason: "url is missing." },
      ],
      engineIds: ["old-c8", "alpha", "unread", "beta", "c8", "old-c7"],
      contractRuntime: () => runtime,
      boardsNaming: (id) => (id === "c8" ? (opts.boards ?? []) : []),
      defaultEngineId: opts.defaultEngineId,
    },
  )
  return { registry, runtime }
}

/** One Camunda 8 engine alone. */
const camunda8Only = () =>
  createEngineRegistry(
    [{ id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" }],
    client,
    { contractRuntime: () => () => new FakeEngine(FakeWorld.seed().state) },
  )

describe("the engines a mark serves and offers", () => {
  it("serves the usable engines of its dialects, a write only the writable ones", () => {
    const { registry } = mixed()
    expect(servedEngineIds(registry, C7)).toEqual(["alpha", "beta"])
    expect(servedEngineIds(registry, EVERY)).toEqual(["alpha", "beta", "c8"])
    expect(servedEngineIds(registry, C7_WRITE)).toEqual(["alpha"])
    expect(servedEngineIds(camunda8Only(), C7)).toEqual([])
  })

  it("offers them in the order of the profiles with each refused profile of its dialects or of none read", () => {
    const { registry } = mixed()
    expect(offeredEngineIds(registry, C7)).toEqual(["alpha", "unread", "beta", "old-c7"])
    expect(offeredEngineIds(registry, EVERY)).toEqual([
      "old-c8",
      "alpha",
      "unread",
      "beta",
      "c8",
      "old-c7",
    ])
    // A refused profile's readOnly is unread: a write names it, and a call to it says why.
    expect(offeredEngineIds(registry, C7_WRITE)).toEqual(["alpha", "unread", "old-c7"])
  })
})

describe("engineServing: the call-time net", () => {
  const SENT =
    'Engine "c8" is a Camunda 8 engine, and this tool or view reads the Camunda 7 REST API (Camunda 7, CIB seven, Operaton), so nothing was sent.'

  it.each([
    [
      "a board names it",
      ["orders"],
      `${SENT} This server reads a Camunda 8 engine on boards only: engine_list_engines lists the boards that name it, and engine_open_cockpit with view board shows one.`,
    ],
    [
      "no board names it",
      [],
      `${SENT} This server reads a Camunda 8 engine on boards only, and no board names "c8" yet; the server's operator adds one.`,
    ],
  ])("refuses an engine of a dialect the mark does not serve when %s", (_, boards, text) => {
    const { registry, runtime } = mixed({ boards })
    const viaDefault = mixed({ boards, defaultEngineId: "c8" }).registry
    for (const call of [
      () => engineServing("c8", registry, C7),
      () => engineServing(undefined, viaDefault, C7),
      // Before ENGINE_READ_ONLY: its profile is read-only too, as every Camunda 8 engine's is.
      () => engineServing("c8", registry, C7_WRITE),
    ]) {
      expect(call).toThrow(EngineDialectNotServedError)
      expect(call).toThrow(text)
    }
    expect(() => engineServing("c8", registry, C7)).toThrow(
      expect.objectContaining({ code: "ENGINE_DIALECT_NOT_SERVED", engineId: "c8" }),
    )
    expect(runtime).not.toHaveBeenCalled()
  })

  it("serves an engine of its dialects, never rerouted, by the precedence of every call", () => {
    const { registry } = mixed({ defaultEngineId: "beta" })
    expect(engineServing("c8", registry, EVERY)).toBe("c8")
    expect(engineServing(undefined, registry, C7)).toBe("beta")
    expect(engineServing("alpha", registry, C7_WRITE)).toBe("alpha")
  })

  it("refuses a write to a read-only engine of its dialect, a refused profile and an unknown id", () => {
    const { registry } = mixed()
    expect(() => engineServing("beta", registry, C7_WRITE)).toThrow(EngineReadOnlyError)
    expect(() => engineServing("beta", registry, C7_WRITE)).toThrow(
      'Engine "beta" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.',
    )
    expect(() => engineServing("old-c7", registry, C7)).toThrow(EngineProfileRefusedError)
    expect(() => engineServing("gamma", registry, C7)).toThrow(UnknownEngineError)
    expect(() => engineServing(undefined, registry, C7)).toThrow(EngineNotSelectedError)
  })
})

// Tool-level cases live in `widget-tools/cockpit.test.ts`; these pin the error contract (#341).
describe("cockpitEngineId", () => {
  it("opens on the override, else on the default engine its start route serves", () => {
    expect(cockpitEngineId("alpha", mixed().registry, C7)).toBe("alpha")
    expect(cockpitEngineId(undefined, mixed({ defaultEngineId: "beta" }).registry, C7)).toBe("beta")
  })

  it("answers null (the picker) for no engine selected, a refused one and one its route does not serve", () => {
    const { registry, runtime } = mixed()
    expect(cockpitEngineId(undefined, registry, C7)).toBeNull()
    expect(cockpitEngineId("old-c7", registry, C7)).toBeNull()
    expect(cockpitEngineId(undefined, mixed({ defaultEngineId: "old-c7" }).registry, C7)).toBe(null)
    expect(cockpitEngineId("c8", registry, C7)).toBeNull()
    expect(cockpitEngineId(undefined, mixed({ defaultEngineId: "c8" }).registry, C7)).toBe(null)
    expect(cockpitEngineId(undefined, camunda8Only(), C7)).toBeNull()
    expect(runtime).not.toHaveBeenCalled()
  })

  it("rejects an unknown engine instead of opening the picker, a broken default too", () => {
    expect(() => cockpitEngineId("gamma", mixed().registry, C7)).toThrow(UnknownEngineError)
    // The config schema refuses such a default; a registry built around it never opens the picker.
    expect(() =>
      cockpitEngineId(undefined, mixed({ defaultEngineId: "gone" }).registry, C7),
    ).toThrow(UnknownEngineError)
  })
})

describe("withServedEngines: the registrar by each tool's mark", () => {
  type Recorded = ToolConfig<EngineRegistry>

  function registerOn(registry: EngineRegistry, ...tools: EngineToolConfig[]) {
    const recorded = new Map<string, Recorded>()
    const record = (config: Recorded) => {
      recorded.set(config.name, config)
    }
    const register = withServedEngines(record as ToolRegistrar<EngineRegistry>, registry)
    for (const tool of tools) register(tool)
    return recorded
  }

  const handler = vi.fn(() => Promise.resolve("ran"))
  const read = (name: string, dialects: EngineToolConfig["dialects"]): EngineToolConfig => ({
    name,
    description: name,
    annotations: { readOnlyHint: true },
    dialects,
    inputSchema: { id: z.string(), ...engineParamShape },
    handler,
  })
  const write = (name: string): EngineToolConfig => ({
    ...read(name, ["c7"]),
    annotations: { destructiveHint: false },
  })
  const enumOf = (config: Recorded | undefined) =>
    (z.toJSONSchema(config?.inputSchema?.engine as z.ZodType) as { enum?: string[] }).enum

  it("offers each tool the engines it serves, and keeps the mark off the registrar's config", () => {
    const tools = registerOn(
      mixed().registry,
      read("c7_read", ["c7"]),
      read("any_read", ["c7", "c8"]),
      write("c7_write"),
    )
    expect(enumOf(tools.get("c7_read"))).toEqual(["alpha", "unread", "beta", "old-c7"])
    expect(enumOf(tools.get("any_read"))).toEqual(offeredEngineIds(mixed().registry, EVERY))
    expect(enumOf(tools.get("c7_write"))).toEqual(["alpha", "unread", "old-c7"])
    expect(tools.get("c7_read")).not.toHaveProperty("dialects")
  })

  it("registers a tool only where a configured engine serves it, a write only where one is writable", () => {
    const c8Tools = registerOn(
      camunda8Only(),
      read("c7_read", ["c7"]),
      read("any_read", ["c7", "c8"]),
    )
    expect([...c8Tools.keys()]).toEqual(["any_read"])
    const readOnly = createEngineRegistry(
      [{ id: "ro", baseUrl: "http://ro/engine-rest", readOnly: true }],
      client,
    )
    expect([...registerOn(readOnly, read("c7_read", ["c7"]), write("c7_write")).keys()]).toEqual([
      "c7_read",
    ])
  })

  it("refuses a call to an engine it does not serve before its handler runs, the default above all", async () => {
    handler.mockClear()
    const { registry } = mixed({ defaultEngineId: "c8" })
    const tools = registerOn(registry, read("c7_read", ["c7"]), write("c7_write"))
    const run = (name: string, args: Record<string, unknown>) =>
      tools.get(name)!.handler(registry, args)
    await expect(run("c7_read", { id: "x" })).rejects.toThrow(EngineDialectNotServedError)
    await expect(run("c7_write", { id: "x", engine: "beta" })).rejects.toThrow(EngineReadOnlyError)
    expect(handler).not.toHaveBeenCalled()
    expect(await run("c7_write", { id: "x", engine: "alpha" })).toBe("ran")
  })

  // The net hangs on what reaches an engine, never on the placeholder: a tool with an `engine`
  // field of its own keeps that field and still meets the net, and so does a write without one,
  // which goes to the default.
  it("runs the net before every tool that names an engine its own way or writes, keeping its input", async () => {
    handler.mockClear()
    const { registry } = mixed({ defaultEngineId: "c8" })
    const ownEngine = { id: z.string(), engine: z.string().optional() }
    const bare = { id: z.string() }
    const tools = registerOn(
      registry,
      { ...read("own_read", ["c7"]), inputSchema: ownEngine },
      { ...write("bare_write"), inputSchema: bare },
    )
    expect(tools.get("own_read")?.inputSchema).toEqual(ownEngine)
    expect(tools.get("bare_write")?.inputSchema).toEqual(bare)
    const run = (name: string, args: Record<string, unknown>) =>
      tools.get(name)!.handler(registry, args)
    await expect(run("own_read", { id: "x", engine: "c8" })).rejects.toThrow(
      EngineDialectNotServedError,
    )
    await expect(run("bare_write", { id: "x" })).rejects.toThrow(EngineDialectNotServedError)
    expect(handler).not.toHaveBeenCalled()
    expect(await run("own_read", { id: "x", engine: "beta" })).toBe("ran")
  })

  it("keeps the input of a tool without the engine placeholder: the engine list reads none", () => {
    const list: EngineToolConfig = {
      name: "list",
      description: "list",
      annotations: { readOnlyHint: true },
      dialects: ["c7", "c8"],
      inputSchema: {},
      handler,
    }
    const tools = registerOn(camunda8Only(), list)
    expect(tools.get("list")?.inputSchema).toEqual({})
    expect(tools.get("list")?.handler).toBe(handler)
  })
})
