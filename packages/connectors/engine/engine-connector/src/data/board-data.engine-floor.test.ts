/**
 * A board's deadline per engine and its floor per engine: an engine that does not answer within
 * BOARD_ENGINE_DEADLINE_MS fails as unreachable while the other engines' tiles read on time, the
 * build that missed it is not kept, and the next build within the floor asks only that engine
 * again while the others answer from the floor, its `asOf` the start of its oldest read, until that
 * read's floor ran out: a build that took an answer of an earlier build is not kept either, so no
 * number outlives its floor. A read the deadline cut leaves the floor once its build ended, in
 * every host: on the server, whose SDK aborts a call's reads once the call answered (here
 * Camunda 8's wire over a platform of the test's, its call's signal aborted as the call returns),
 * and in a host without a request signal, where the cut read runs on: only a build that overlaps
 * it in time shares it, and its late answer is kept nowhere. The other engines are runtimes of the
 * engine contract, so the clock is the test's; the Camunda 7 wire's own case reads two fake
 * engines over HTTP.
 */

import { BoardParser, type TileData } from "@miragon/pulse-board"
import type { EngineInfo, ProcessRuntime } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld, PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EngineBoard } from "../board-files.js"
import { createC8Connection } from "../lib/engine/c8-connection.js"
import { c8RuntimeOf } from "../lib/engine/engine-runtime.js"
import {
  type ContractRuntime,
  createEngineRegistry,
  resolveEngine,
  resolveRuntimeEngine,
} from "../lib/engine/resolve-engine.js"
import { c8Platform, CLUSTER, hang, json } from "../lib/engine/test-support/c8-platform.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_FAILURE, readOf, worldReply } from "../tools/test-support/engine-world.js"
import {
  type FakeEngine as FakeC7Engine,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import { BOARD_ENGINE_DEADLINE_MS, cachedBoardData } from "./board-data.js"
import { BOARD_FLOOR_MS } from "./board-floor.js"

const c7Engines: FakeC7Engine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(c7Engines.splice(0).map((engine) => engine.close()))
})

/** A board over `names`: a counter, an instance list and the open incidents. */
function boardOver(names: readonly string[], process = "pulse-order", id = "orders"): EngineBoard {
  const parsed = BoardParser.parse(
    JSON.stringify({
      title: "Orders",
      engines: names,
      rows: [
        { row: [{ widget: "counter", props: { filter: { process } } }] },
        { row: [{ widget: "instanceList", props: { filter: { process } } }] },
        { row: [{ widget: "incidentList" }] },
      ],
    }),
  )
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id, file: `${id}.board.json`, board: parsed.board, notes: [] }
}

/** A runtime of the fake world, `patch` over it, that notes each read it is asked. */
function engineOf(patch: Partial<ProcessRuntime> = {}) {
  const calls: string[] = []
  const world = new PatchedRuntime(new FakeEngine(FakeWorld.seed().state), patch)
  const runtime = new Proxy(world, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        calls.push(String(key))
        return (value as (...parameters: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return { runtime, calls }
}

/** An engine of the fake world whose first probe answers as `first` does, every later one at once. */
function firstProbe(first: (answer: () => Promise<EngineInfo>) => Promise<EngineInfo>) {
  const world = new FakeEngine(FakeWorld.seed().state)
  let asked = false
  return engineOf({
    describeEngine: () => {
      if (asked) return world.describeEngine()
      asked = true
      return first(() => world.describeEngine())
    },
  })
}

/** The engines of a board as the server resolves them: profiles whose runtime is the contract's. */
function registryOver(runtimes: Readonly<Record<string, ContractRuntime>>) {
  return createEngineRegistry(
    Object.keys(runtimes).map((id) => ({
      id,
      baseUrl: `https://${id}.example/v2`,
      flavor: "camunda8" as const,
    })),
    () => {
      throw new Error("a contract engine has no client")
    },
    { contractRuntime: ({ id }) => runtimes[id] },
  )
}

/** The engines `runtimes` in a host without a request signal: a cut read runs on. */
function resolverOver(runtimes: Readonly<Record<string, ProcessRuntime>>) {
  const registry = registryOver(
    Object.fromEntries(Object.entries(runtimes).map(([id, runtime]) => [id, () => runtime])),
  )
  return (name: string) => resolveRuntimeEngine(name, registry)
}

/** What each tile shows per engine: the counter's readings, the lists' rows per engine. */
const perEngine = (tile: TileData | undefined): unknown => {
  if (tile?.kind === "counter") return tile.readings
  if (tile?.kind === "instanceList") return tile.groups.map((group) => group.instances?.length)
  if (tile?.kind === "incidentList") return tile.groups.map((group) => group.incidents?.length)
  return tile?.kind
}

const SILENT = () => new Promise<never>(() => undefined)
const states = (data: { engines: readonly { state: string }[] }) =>
  data.engines.map(({ state }) => state)

describe("a board engine that never answers", () => {
  it("fails as unreachable at the deadline, while the other engine's tiles read on time", async () => {
    vi.useFakeTimers()
    const shop = engineOf()
    const stuck = engineOf({ describeEngine: SILENT })
    const board = boardOver(["shop", "stuck"])
    const building = cachedBoardData(
      board,
      resolverOver({ shop: shop.runtime, stuck: stuck.runtime }),
    )
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS - 1)
    expect(shop.calls).toContain("countInstances")

    await vi.advanceTimersByTimeAsync(1)
    const data = await building
    expect(data.engines).toEqual([
      expect.objectContaining({ name: "shop", state: "ready" }),
      {
        name: "stuck",
        state: "failed",
        failure: {
          code: "unreachable",
          message: "stuck did not answer the board's reads within 15000 ms.",
        },
      },
    ])
    expect(data.rows.map(([tile]) => perEngine(tile))).toEqual([
      [{ engine: "shop", count: { count: 3 } }, { engine: "stuck" }],
      [3, undefined],
      [2, undefined],
    ])
    expect(stuck.calls).toEqual(["describeEngine"])
  })
})

describe("on the server, where the SDK aborts a call's reads once the call answered", () => {
  /** `shop` of the fake world beside the cluster `stuck` on Camunda 8's wire, read call by call. */
  function server(topology: Parameters<typeof c8Platform>[0][string]) {
    const shop = engineOf()
    const none = () => json({ items: [], page: { totalItems: 0, hasMoreTotalItems: false } })
    const platform = c8Platform({
      "GET /v2/topology": topology,
      "POST /v2/process-definitions/search": none,
      "POST /v2/process-definitions/statistics/process-instances": none,
    })
    const connection = createC8Connection(
      { id: "stuck", baseUrl: CLUSTER },
      { type: "none" },
      {},
      platform,
    )
    const registry = registryOver({ shop: () => shop.runtime, stuck: c8RuntimeOf(connection) })
    const call = async (board: EngineBoard) => {
      const request = new AbortController()
      try {
        return await cachedBoardData(board, (name) =>
          resolveRuntimeEngine(name, registry, { mcpReq: { signal: request.signal } }),
        )
      } finally {
        request.abort()
      }
    }
    const probes = () => platform.sent.filter(({ path }) => path === "/v2/topology")
    return { shop, call, probes }
  }

  it("asks only the engine the deadline cut again within the floor, the other one answers from it", async () => {
    vi.useFakeTimers()
    const { shop, call, probes } = server(hang)
    const board = boardOver(["shop", "stuck"])
    const first = call(board)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    const missed = await first
    expect(states(missed)).toEqual(["ready", "failed"])
    expect(probes().map(({ signal }) => signal?.aborted)).toEqual([true])
    const asked = [...shop.calls]

    await vi.advanceTimersByTimeAsync(1_000)
    const second = call(board)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    const data = await second
    expect(states(data)).toEqual(["ready", "failed"])
    expect(data.rows[0]?.[0]).toMatchObject({ kind: "counter", known: 1 })
    expect(data.asOf).toBe(missed.asOf)
    expect(shop.calls).toEqual(asked)
    expect(probes()).toHaveLength(2)
  })

  it("shows the engine ready on the next build once it answers again", async () => {
    vi.useFakeTimers()
    let hanging = true
    const { shop, call, probes } = server((request) =>
      hanging ? hang(request) : json({ gatewayVersion: "8.10.9", brokers: [] }),
    )
    const board = boardOver(["shop", "stuck"])
    const first = call(board)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    await first
    const asked = [...shop.calls]

    hanging = false
    const data = await call(board)
    expect(states(data)).toEqual(["ready", "ready"])
    expect(shop.calls).toEqual(asked)
    expect(probes()).toHaveLength(2)
  })
})

describe("in a host without a request signal, where a read the deadline cut runs on", () => {
  it("asks that engine anew on the next build, which shows it ready at once once it answers", async () => {
    vi.useFakeTimers()
    const shop = engineOf()
    const stuck = firstProbe(SILENT)
    const board = boardOver(["shop", "stuck"])
    const resolve = resolverOver({ shop: shop.runtime, stuck: stuck.runtime })
    const first = cachedBoardData(board, resolve)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    await first
    const asked = [...shop.calls]

    await vi.advanceTimersByTimeAsync(1_000)
    const data = await cachedBoardData(board, resolve)
    expect(states(data)).toEqual(["ready", "ready"])
    expect(shop.calls).toEqual(asked)
    expect(stuck.calls.filter((read) => read === "describeEngine")).toHaveLength(2)
  })

  it("shares it with a build that overlaps it in time, never with one after its build ended", async () => {
    vi.useFakeTimers()
    const stuck = engineOf({ describeEngine: SILENT })
    const resolve = resolverOver({ shop: engineOf().runtime, stuck: stuck.runtime })
    const [orders, stock] = [
      boardOver(["shop", "stuck"]),
      boardOver(["stuck"], "pulse-order", "stock"),
    ]
    const first = cachedBoardData(orders, resolve)
    await vi.advanceTimersByTimeAsync(5_000)
    const overlapping = cachedBoardData(stock, resolve)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    expect(states(await first)).toEqual(["ready", "failed"])
    expect(states(await overlapping)).toEqual(["failed"])
    expect(stuck.calls).toEqual(["describeEngine"])

    const after = cachedBoardData(orders, resolve)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    await after
    expect(stuck.calls).toEqual(["describeEngine", "describeEngine"])
  })

  it("keeps no late answer of it: the next build asks the engine again", async () => {
    vi.useFakeTimers()
    const stuck = firstProbe(
      (answer) => new Promise((resolve) => setTimeout(() => resolve(answer()), 20_000)),
    )
    const board = boardOver(["shop", "stuck"])
    const resolve = resolverOver({ shop: engineOf().runtime, stuck: stuck.runtime })
    const first = cachedBoardData(board, resolve)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    expect(states(await first)).toEqual(["ready", "failed"])
    await vi.advanceTimersByTimeAsync(20_000 - BOARD_ENGINE_DEADLINE_MS)

    const data = await cachedBoardData(board, resolve)
    expect(states(data)).toEqual(["ready", "ready"])
    expect(stuck.calls.filter((read) => read === "describeEngine")).toHaveLength(2)
  })
})

describe("a board engine the deadline cut", () => {
  it("is the only engine a build within the floor reads again, and no number outlives its floor", async () => {
    vi.useFakeTimers()
    const shop = engineOf()
    const stuck = firstProbe(SILENT)
    const board = boardOver(["shop", "stuck"])
    const resolve = resolverOver({ shop: shop.runtime, stuck: stuck.runtime })
    const first = cachedBoardData(board, resolve)
    await vi.advanceTimersByTimeAsync(BOARD_ENGINE_DEADLINE_MS)
    const { asOf } = await first
    await vi.advanceTimersByTimeAsync(20_000 - BOARD_ENGINE_DEADLINE_MS)
    const asked = [...shop.calls]

    const second = await cachedBoardData(board, resolve)
    expect(states(second)).toEqual(["ready", "ready"])
    expect(second.rows.map(([tile]) => perEngine(tile))).toEqual([
      [
        { engine: "shop", count: { count: 3 } },
        { engine: "stuck", count: { count: 3 } },
      ],
      [3, 3],
      [2, 2],
    ])
    expect(second.asOf).toBe(asOf)
    expect(shop.calls).toEqual(asked)
    expect([...stuck.calls].sort()).toEqual([
      "countInstances",
      "describeEngine",
      "describeEngine",
      "listDefinitions",
      "searchIncidents",
      "searchInstances",
    ])
    const kept = [shop.calls.length, stuck.calls.length]
    expect(await cachedBoardData(board, resolve)).toEqual(second)
    expect([shop.calls.length, stuck.calls.length]).toEqual(kept)

    await vi.advanceTimersByTimeAsync(BOARD_FLOOR_MS - 20_000)
    const third = await cachedBoardData(board, resolve)
    expect(third.asOf).toBe(new Date(Date.parse(asOf) + 20_000).toISOString())
    expect(shop.calls.length).toBeGreaterThan(kept[0] ?? 0)
    expect(stuck.calls).toHaveLength(kept[1] ?? 0)
  })
})

describe("a board over two Camunda 7 engines, one of whose reads failed", () => {
  it("reads only the failed read of that engine again, then nothing more within the floor", async () => {
    let failing = true
    const shop = await startFakeEngine({}, worldReply)
    const flaky = await startFakeEngine({}, (request) =>
      failing && readOf(request).includes("/count") ? ENGINE_FAILURE : worldReply(request),
    )
    c7Engines.push(shop, flaky)
    const registry = createEngineRegistry(
      [
        { id: "shop", baseUrl: shop.baseUrl },
        { id: "flaky", baseUrl: flaky.baseUrl },
      ],
      (entry) => providerForEntry(entry).createClient(entry, { type: "none" }),
    )
    const resolve = (name: string) => resolveEngine(name, registry)
    const board = boardOver(["shop", "flaky"], "order")
    const missed = await cachedBoardData(board, resolve)
    expect(missed.rows[0]?.[0]).toMatchObject({ kind: "counter", known: 1 })
    const counts = flaky.requests.map(readOf).filter((read) => read.includes("/count"))
    const [shopReads, flakyReads] = [shop.requests.length, flaky.requests.length]

    failing = false
    const built = await cachedBoardData(board, resolve)
    expect(built.rows[0]?.[0]).toMatchObject({ kind: "counter", known: 2 })
    expect(shop.requests).toHaveLength(shopReads)
    expect(flaky.requests.slice(flakyReads).map(readOf)).toEqual(counts)

    expect(await cachedBoardData(board, resolve)).toEqual(built)
    expect(shop.requests).toHaveLength(shopReads)
    expect(flaky.requests).toHaveLength(flakyReads + counts.length)
  })
})
