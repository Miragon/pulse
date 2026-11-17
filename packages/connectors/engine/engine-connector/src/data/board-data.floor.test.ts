/**
 * The board feed's floor: a build is kept per caller and board for 30 seconds, never one that
 * missed a read (each read of the degrade table broken in turn) or holds an undecided reading,
 * and a build its caller cancelled is read again for a call that shared it, on the Camunda 7 SDK
 * wire and on the server's Camunda 8 wire. A Camunda 7 count is
 * exact, so the runtime here can be switched to answer every count as a lower bound, as a dialect
 * with capped counts would.
 */

import { BoardParser } from "@miragon/pulse-board"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EngineBoard } from "../board-files.js"
import { createC8Connection } from "../lib/engine/c8-connection.js"
import { c8RuntimeOf } from "../lib/engine/engine-runtime.js"
import {
  createEngineRegistry,
  resolveEngine,
  resolveRuntimeEngine,
} from "../lib/engine/resolve-engine.js"
import { c8Platform, CLUSTER, hang, json } from "../lib/engine/test-support/c8-platform.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_FAILURE, readOf, worldReply } from "../tools/test-support/engine-world.js"
import {
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import type * as EngineRuntime from "../lib/engine/engine-runtime.js"
import { BOARD_FLOOR_MS, cachedBoardData } from "./board-data.js"
import { DEGRADE, worldBoard, worldResolver } from "./honest-numbers.test-support.js"

const runtimes = vi.hoisted(() => ({ countsAreLowerBounds: false }))

vi.mock("../lib/engine/engine-runtime.js", async (importOriginal) => {
  const original = await importOriginal<typeof EngineRuntime>()
  const runtimeOf: typeof original.runtimeOf = (engine) => {
    const runtime = original.runtimeOf(engine)
    if (!runtimes.countsAreLowerBounds) return runtime
    return new Proxy(runtime, {
      get: (target, key, receiver) =>
        key === "countInstances"
          ? async (filter: Parameters<typeof target.countInstances>[0]) => ({
              ...(await target.countInstances(filter)),
              atLeast: true as const,
            })
          : (Reflect.get(target, key, receiver) as unknown),
    })
  }
  return { ...original, runtimeOf }
})

const engines: FakeEngine[] = []
afterEach(async () => {
  runtimes.countsAreLowerBounds = false
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** A board over `names` with a counter that warns above 5, as its own owner of the floor. */
function boardOver(names: readonly string[]): EngineBoard {
  const parsed = BoardParser.parse(
    JSON.stringify({
      title: "Orders",
      engines: names,
      rows: [
        { row: [{ widget: "counter", props: { filter: { process: "order" }, warnAbove: 5 } }] },
      ],
    }),
  )
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id: "orders", file: "orders.board.json", board: parsed.board, notes: [] }
}

/** The fake engine as the engine `shop`, beside a refused profile `locked`. */
async function shop(routes: FakeRoutes = {}) {
  const engine = await startFakeEngine(routes, worldReply)
  engines.push(engine)
  const registry = createEngineRegistry(
    [{ id: "shop", baseUrl: engine.baseUrl }],
    (entry) => providerForEntry(entry).createClient(entry, { type: "none" }),
    { refused: [{ id: "locked", reason: "auth.tokenEnv names a variable that is not set." }] },
  )
  const resolveWith = (signal?: AbortSignal) => (name: string) =>
    resolveEngine(name, registry, signal === undefined ? undefined : { mcpReq: { signal } })
  return { engine, resolve: resolveWith(), resolveWith }
}

describe("cachedBoardData keeps a build per caller and board for 30 seconds", () => {
  it("answers from the build of the last 30 seconds, then reads again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { engine, resolve } = await shop()
    const board = boardOver(["shop"])
    const first = await cachedBoardData(board, resolve)
    const reads = engine.requests.length
    expect(reads).toBeGreaterThan(0)

    vi.setSystemTime(Date.now() + BOARD_FLOOR_MS - 1)
    expect(await cachedBoardData(board, resolve)).toBe(first)
    expect(engine.requests).toHaveLength(reads)

    vi.setSystemTime(Date.now() + 1)
    const second = await cachedBoardData(board, resolve)
    expect(engine.requests).toHaveLength(2 * reads)
    expect(second.asOf).not.toBe(first.asOf)
  })

  it("builds another caller's board on its own", async () => {
    const { engine, resolve } = await shop()
    const board = boardOver(["shop"])
    const as = (token: string) =>
      runWithMcpRequestInfo({ authorization: `Bearer ${token}` }, () =>
        cachedBoardData(board, resolve),
      )
    await as("ada")
    const reads = engine.requests.length
    await as("ada")
    expect(engine.requests).toHaveLength(reads)
    await as("bob")
    expect(engine.requests).toHaveLength(2 * reads)
  })

  it("keeps the build of a board with a refused profile: it reads nothing there", async () => {
    const { engine, resolve } = await shop()
    const board = boardOver(["shop", "locked"])
    const first = await cachedBoardData(board, resolve)
    expect(first.engines.map(({ state }) => state)).toEqual(["ready", "failed"])
    const reads = engine.requests.length
    expect(await cachedBoardData(board, resolve)).toBe(first)
    expect(engine.requests).toHaveLength(reads)
  })
})

describe("cachedBoardData keeps no build that is not final", () => {
  it("reads again after a build whose engine failed to say what it is", async () => {
    let failing = true
    const { resolve } = await shop({
      "GET /telemetry/data": (request) => (failing ? ENGINE_FAILURE : worldReply(request)),
    })
    const board = boardOver(["shop"])
    expect((await cachedBoardData(board, resolve)).engines[0]?.state).toBe("failed")
    failing = false
    const ready = await cachedBoardData(board, resolve)
    expect(ready.engines[0]?.state).toBe("ready")
    expect(await cachedBoardData(board, resolve)).toBe(ready)
  })

  it("reads again after a build that missed a tile's read", async () => {
    let failing = true
    const { resolve } = await shop({
      "POST /history/process-instance/count": (request) =>
        failing ? ENGINE_FAILURE : worldReply(request),
    })
    const board = boardOver(["shop"])
    const missed = await cachedBoardData(board, resolve)
    expect(missed.rows[0]?.[0]).toMatchObject({ kind: "counter", known: 0 })
    failing = false
    const counter = (await cachedBoardData(board, resolve)).rows[0]?.[0]
    expect(counter).toMatchObject({ kind: "counter", known: 1, total: { count: 1 } })
  })

  it("reads again after a build whose reading is undecided: a lower bound at or below its threshold", async () => {
    runtimes.countsAreLowerBounds = true
    const { engine, resolve } = await shop()
    const board = boardOver(["shop"])
    const first = await cachedBoardData(board, resolve)
    expect(first.rows[0]?.[0]).toMatchObject({
      readings: [{ engine: "shop", count: { count: 1, atLeast: true }, undecided: true }],
    })
    const reads = engine.requests.length
    await cachedBoardData(board, resolve)
    expect(engine.requests).toHaveLength(2 * reads)
  })
})

describe("cachedBoardData keeps no build that missed any of its reads", () => {
  it.each(Object.keys(DEGRADE.buildBoardData.places))(
    "reads again after a build whose read %s failed, then keeps the build",
    async (read) => {
      let failing = true
      const engine = await startFakeEngine({}, (request) =>
        failing && readOf(request) === read ? ENGINE_FAILURE : worldReply(request),
      )
      engines.push(engine)
      const board = worldBoard()
      const resolve = worldResolver(engine.baseUrl)
      await cachedBoardData(board, resolve)
      expect(engine.requests.map(readOf)).toContain(read)
      failing = false
      const missed = engine.requests.length
      await cachedBoardData(board, resolve)
      expect(engine.requests.slice(missed).map(readOf)).toContain(read)
      const kept = engine.requests.length
      await cachedBoardData(board, resolve)
      expect(engine.requests).toHaveLength(kept)
    },
  )
})

describe("cachedBoardData and a caller that goes away", () => {
  it("fails the build its caller cancelled, and reads again for a call that shared it", async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let holding = true
    const { engine, resolveWith } = await shop({
      "GET /telemetry/data": async (request) => {
        if (holding) {
          holding = false
          await held
        }
        return worldReply(request)
      },
    })
    const board = boardOver(["shop"])
    const leaving = new AbortController()
    const first = cachedBoardData(board, resolveWith(leaving.signal))
    const joined = cachedBoardData(board, resolveWith(new AbortController().signal))
    await vi.waitFor(() => expect(engine.requests.map(readOf)).toContain("GET /telemetry/data"))
    leaving.abort()
    await expect(first).rejects.toMatchObject({ kind: "cancelled" })
    const data = await joined
    expect(data.engines[0]?.state).toBe("ready")
    release()
  })

  it("fails a build its caller cancelled on Camunda 8's wire too, and reads again for a call that shared it", async () => {
    let holding = true
    const platform = c8Platform({
      "GET /v2/topology": (request) => {
        if (!holding) return json({ gatewayVersion: "8.10.9", brokers: [] })
        holding = false
        return hang(request)
      },
    })
    const connection = createC8Connection(
      { id: "cluster", baseUrl: CLUSTER },
      { type: "none" },
      {},
      platform,
    )
    const registry = createEngineRegistry(
      [{ id: "cluster", baseUrl: CLUSTER, flavor: "camunda8" }],
      () => {
        throw new Error("a Camunda 8 engine has no client")
      },
      { contractRuntime: () => c8RuntimeOf(connection) },
    )
    const resolveWith = (signal: AbortSignal) => (name: string) =>
      resolveRuntimeEngine(name, registry, { mcpReq: { signal } })
    const board = boardOver(["cluster"])
    const leaving = new AbortController()
    const first = cachedBoardData(board, resolveWith(leaving.signal))
    const joined = cachedBoardData(board, resolveWith(new AbortController().signal))
    await vi.waitFor(() => expect(platform.sent.map(({ path }) => path)).toContain("/v2/topology"))
    leaving.abort()
    await expect(first).rejects.toMatchObject({
      failure: "unreachable",
      message: "request to engine cluster was cancelled by the caller",
    })
    const data = await joined
    expect(data.engines[0]?.state).toBe("ready")
  })
})
