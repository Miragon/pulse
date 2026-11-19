import { describe, it, expect } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { registerEngineTools } from "./engines.js"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { captureTools } from "./test-support/fake-engine.js"
import type { EngineEntry } from "../engine-provider.js"
import { createEngineRegistry, type EngineRegistry } from "../lib/engine/resolve-engine.js"
import { ENGINE_LIST_ENGINES } from "../tool-names.js"
import type { BoardFiles } from "../board-files.js"
import { worldBoard } from "../data/honest-numbers.test-support.js"

const ENGINES = [
  { id: "alpha", baseUrl: "http://alpha/engine-rest", cockpitUrl: "http://alpha/cockpit" },
  { id: "beta", baseUrl: "http://beta/engine-rest" },
]

type Handler = (
  reg: EngineRegistry,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>

/** Toolset mechanics are `lib/mcp/toolsets.test.ts`'s; this pins the handler contract. */
function harness(engines: EngineEntry[] = ENGINES, defaultEngineId?: string, boards?: BoardFiles) {
  const registry = createEngineRegistry(engines, (e) => ({ __engine: e.id }) as unknown as Client, {
    defaultEngineId,
  })
  const configs = captureTools((register) =>
    registerEngineTools(register, DEFAULT_VERDICT_THRESHOLDS, boards),
  )
  const handlerOf = (name: string) => {
    const config = configs.get(name)
    if (!config) throw new Error(`${name} did not register`)
    return (config as unknown as { handler: Handler }).handler
  }
  const list = () => handlerOf(ENGINE_LIST_ENGINES)(registry, {})
  return { list, configs }
}

describe("the engine tool", () => {
  it("engine_list_engines is a genuine read-only tool without input", () => {
    const config = harness().configs.get(ENGINE_LIST_ENGINES)!
    expect(config.category).toBe("engines")
    expect(config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(config.inputSchema).toEqual({})
    expect(config.description).toBe(
      "List the configured engines, grouped by environment (`environments` maps each " +
        "to its engine ids), plus the default engine (`defaultEngineId`, null when none) and the " +
        "server's boards, if it has any (`boards`).",
    )
  })
})

describe("engine_list_engines", () => {
  it("reports null when no default engine is configured", async () => {
    const { list: listEngines } = harness()
    expect((await listEngines()).defaultEngineId).toBeNull()
  })

  it("reports the configured default engine, next to every engine", async () => {
    const { list: listEngines } = harness(ENGINES, "beta")
    const list = await listEngines()
    expect(list.defaultEngineId).toBe("beta")
    expect((list.engines as Array<{ id: string }>).map((e) => e.id)).toEqual(["alpha", "beta"])
  })

  it("never hands the model an engine's internal REST baseUrl, only a configured cockpitUrl", async () => {
    const { list: listEngines } = harness()
    const list = await listEngines()
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
    const list = await listEngines()
    expect((list.engines as Array<{ environment: string }>).map((e) => e.environment)).toEqual([
      "default",
      "default",
    ])
    expect(list.environments).toEqual([{ id: "default", engineIds: ["alpha", "beta"] }])
  })

  it("maps environments to their engines in config order: the two-stage selection view", async () => {
    const { list: listEngines } = harness([
      { id: "eu-a", baseUrl: "http://eu-a/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a/engine-rest", environment: "prod-us" },
      { id: "eu-b", baseUrl: "http://eu-b/engine-rest", environment: "prod-eu" },
    ])
    const list = await listEngines()
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

describe("engine_list_engines with ENGINE_BOARDS_DIR", () => {
  const PROBLEM = { path: "$.rows", code: "missing" } as const

  it("names each board by its id, title and engines, a refused file by its problem count", async () => {
    const boards: BoardFiles = {
      boards: [worldBoard()],
      refused: [{ id: "broken", file: "broken.board.json", problems: [PROBLEM, PROBLEM] }],
    }
    const result = await harness(ENGINES, undefined, boards).list()
    expect(result.boards).toEqual([{ id: "orders", title: "Orders", engines: ["fake"] }])
    expect(result.refusedBoards).toEqual([{ id: "broken", problems: 2 }])
  })

  it("lists no refused board while every file gives one", async () => {
    const result = await harness(ENGINES, undefined, { boards: [], refused: [] }).list()
    expect(result.boards).toEqual([])
    expect(result).not.toHaveProperty("refusedBoards")
  })

  it("without it, the result names no board", async () => {
    const result = await harness().list()
    expect(result).not.toHaveProperty("boards")
    expect(result).not.toHaveProperty("refusedBoards")
  })
})
