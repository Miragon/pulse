/**
 * The engine contract's conformance kit over the MCP server's SDK wire: the runtime the server
 * runs (`runtimeOf`, c7-core's `C7Runtime` on the connector's engine port over
 * `createEngineConnection`, the client every tool sends through, its failures read by
 * `runtimeErrorOf`), against a real engine of the
 * Camunda 7 REST family in a container (`PULSE_ENGINE_IMAGE`, Operaton 2.1.5 without one; CI runs
 * Operaton and CIB seven), seeded with the kit's world through c7-core's `seedC7World`. The read
 * laws hold here as on the C7 adapter's wire, the unreachable engine at 127.0.0.1:9 included. No
 * law reads a bulk operation, so two cases of this suite do: a batch it starts itself, and an id
 * the engine does not know. c7-core's recorded board (`C7_BOARD_ENGINE`), built by the board
 * feed's builder over the seeded world, shows every tile read, with the numbers the kit's fake
 * world gives and its recording holds, and the cockpit's "With incident" chip of a process (the
 * instance list's POST count) counts what the board's counter of that process (the runtime's GET
 * count) counts.
 *
 * `pnpm --fail-if-no-match --filter @miragon/pulse-engine-connector test:engines` (Docker); its
 * own container start, since no package shares a Node test helper with another.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type BoardData, BoardParser, type TileData } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson } from "@miragon/pulse-board/builder"
import {
  C7_BOARD_ENGINE,
  type C7SeedEngine,
  type C7UnknownIds,
  seedC7World,
} from "@miragon/pulse-c7-core/testing"
import {
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import {
  type ConformanceHarness,
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type SeededWorld,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
} from "@miragon/pulse-engine-core/testing"
import { buildBoardData } from "../../data/board-data.js"
import { buildProcessInstancesData } from "../../data/cockpit-data.js"
import type { C7Flavor } from "../../engine-provider.js"
import { providerForEntry } from "../../providers/index.js"
import { createEngineConnection } from "../engine/engine-connection.js"
import { runtimeOf } from "../engine/engine-runtime.js"
import {
  createEngineRegistry,
  type ResolvedEngine,
  resolveEngine,
} from "../engine/resolve-engine.js"

const ENGINE_IMAGE = process.env.PULSE_ENGINE_IMAGE ?? "operaton/operaton:2.1.5"
const ENGINE_PORT = 8080
const REST_ROOT = "/engine-rest"
const STARTUP_TIMEOUT_MS = 180_000
const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
/** How long the engine may take to work a batch of one instance off, as the command laws allow. */
const BATCH_RUNS_WITHIN_MS = 90_000

/**
 * The engine keeps its full history (the history level the read laws run at here; the C7
 * adapter's suite runs them at AUDIT too) and runs without its bundled invoice example: that sets
 * the engine's clock back by days while it seeds itself, after the REST API already answers, so
 * the world's timestamps would come from the rewound clock.
 */
const ENGINE_ENVIRONMENT = {
  CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: "false",
  OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false",
  CAMUNDA_BPM_HISTORY_LEVEL: "full",
  OPERATON_BPM_HISTORY_LEVEL: "full",
} as const

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface RunningEngine {
  readonly url: string
  stop(): Promise<void>
}

/** The JSON answer of a request the test sends itself, over the REST API without the SDK. */
async function rest(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  )
  if (!response.ok) {
    throw new Error(`${body === undefined ? "GET" : "POST"} ${url}: HTTP ${response.status}`)
  }
  return response.json()
}

async function startEngine(): Promise<RunningEngine> {
  const container = await new GenericContainer(ENGINE_IMAGE)
    .withEnvironment(ENGINE_ENVIRONMENT)
    .withExposedPorts(ENGINE_PORT)
    .withWaitStrategy(Wait.forHttp(`${REST_ROOT}/version`, ENGINE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
  const url = `http://${container.getHost()}:${container.getMappedPort(ENGINE_PORT)}${REST_ROOT}`
  const example = (await rest(`${url}/process-definition/count?key=invoice`)) as { count: number }
  if (example.count > 0) {
    await container.stop()
    throw new Error(
      `${ENGINE_IMAGE} runs its example application: disable it in ENGINE_ENVIRONMENT`,
    )
  }
  return { url, stop: () => container.stop().then(() => undefined) }
}

/** A world diagram, read from c7-core's world/ in the repository. */
function worldDiagram(process: string): string {
  const file = new URL(`../../../../../c7/c7-core/world/${process}.bpmn`, import.meta.url)
  return readFileSync(fileURLToPath(file), "utf8")
}

function branded<Key extends string, Id>(
  ids: Readonly<Record<Key, string>>,
  brand: (id: string) => Id,
): Record<Key, Id> {
  const entries = Object.entries<string>(ids).map(([key, id]) => [key, brand(id)])
  return Object.fromEntries(entries) as Record<Key, Id>
}

function unknownOf(unknown: C7UnknownIds): SeededWorld["unknown"] {
  return {
    definitionId: DefinitionId(unknown.definitionId),
    instanceId: InstanceId(unknown.instanceId),
    incidentId: IncidentId(unknown.incidentId),
    bulkOperationId: BulkOperationId(unknown.bulkOperationId),
  }
}

/** The kit's world, seeded by c7-core over the global fetch, its ids branded. */
async function seedWorld(url: string): Promise<SeededWorld> {
  const engine: C7SeedEngine = { url, send: (target, request) => fetch(target, request), wait }
  const diagrams = Object.fromEntries(
    WORLD_DEPLOYMENTS.map(({ process }) => [process, worldDiagram(process)]),
  )
  const world = await seedC7World(engine, {
    deployments: WORLD_DEPLOYMENTS,
    instances: WORLD_INSTANCES,
    localVariable: WORLD_LOCAL_VARIABLE,
    diagrams,
  })
  return {
    definitionIds: branded(world.definitionIds, DefinitionId),
    instanceIds: branded(world.instanceIds, InstanceId),
    unknown: unknownOf(world.unknown),
  }
}

/** The vendor of the engine image, as a profile names it: CIB seven's or Operaton's. */
const ENGINE_FLAVOR: C7Flavor = ENGINE_IMAGE.startsWith("cibseven/") ? "cibseven" : "operaton"

/** The runtime the MCP server runs on the engine at `baseUrl`, over its SDK wire. */
function runtimeAt(id: string, baseUrl: string): ProcessRuntime {
  const entry = { id, baseUrl, flavor: ENGINE_FLAVOR }
  return runtimeOf({
    client: createEngineConnection(entry, { type: "none" }),
    provider: providerForEntry(entry),
  })
}

/**
 * A batch that cancels one instance of order v2 the test starts itself (the world's waiting
 * route), started over the REST API: its id.
 */
async function startCancellation(url: string, world: SeededWorld): Promise<BulkOperationId> {
  const definitionId = world.definitionIds["order@2"]
  const started = (await rest(`${url}/process-definition/${definitionId}/start`, {
    businessKey: "MCP-BULK-1",
    variables: { route: { value: "review", type: "String" } },
  })) as { id: string }
  const batch = (await rest(`${url}/process-instance/delete`, {
    processInstanceIds: [started.id],
    deleteReason: "the MCP SDK wire's bulk case",
    skipCustomListeners: true,
  })) as { id: string; type: string }
  expect(batch.type).toBe("instance-deletion")
  return BulkOperationId(batch.id)
}

/**
 * c7-core's recorded board as the server's board files hand it on: every widget over the world's
 * engine, which the board names `conformance`, and a refused one.
 */
const RECORDED_BOARD = (() => {
  const parsed = BoardParser.parse(C7_BOARD_ENGINE.text)
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id: "orders", file: "orders.board.json", board: parsed.board, notes: parsed.notes }
})()

/** The engine the recorded board names, at `url`, as the server resolves an engine by name. */
function boardEngineAt(url: string): (name: string) => ResolvedEngine {
  const registry = createEngineRegistry(
    [{ id: C7_BOARD_ENGINE.engine, baseUrl: url, flavor: ENGINE_FLAVOR }],
    (entry) => providerForEntry(entry).createClient(entry, { type: "none" }),
  )
  return (name) => resolveEngine(name, registry)
}

/** Rows in one order: the engines order instances and incidents by times each sets on its own. */
const unordered = (rows: readonly unknown[] | undefined) =>
  rows?.map((row) => JSON.stringify(row)).sort()

/**
 * A tile's figures, without the ids, the dates and the order of rows each engine makes on its
 * own, nor an incident's type, which each dialect names in its words.
 */
function tileFigures(tile: TileData): unknown {
  switch (tile.kind) {
    case "counter":
      return { readings: tile.readings.map(({ count }) => count ?? null), total: tile.total }
    case "instanceList":
      return tile.groups.map(({ instances, total }) => ({
        total,
        rows: unordered(
          instances?.map(({ businessKey, state, hasIncident, definition }) => [
            businessKey,
            state,
            hasIncident,
            definition.version,
          ]),
        ),
      }))
    case "incidentSummary":
      return {
        total: tile.total,
        rows: unordered(
          tile.rows.map(({ engine, process, withIncident }) => [
            engine,
            process?.bpmnProcessId,
            withIncident,
          ]),
        ),
      }
    case "processDiagram":
      return { version: tile.latest?.version, badges: unordered(tile.badges) }
    case "incidentList":
      return tile.groups.map(({ incidents, more }) => ({
        more,
        rows: unordered(incidents?.map(({ elementId }) => elementId)),
      }))
    case "refused":
      return tile.problems
  }
}

/** A board's figures: each engine's state and totals, each tile's numbers. */
const figuresOf = (data: BoardData) => ({
  engines: data.engines.map((engine) => (engine.state === "ready" ? engine.totals : engine.state)),
  tiles: data.rows.flat().map(tileFigures),
})

/** The seeded engine and the kit's harness over it. */
interface Suite {
  readonly url: string
  readonly harness: ConformanceHarness
}

describe(`c7-core's runtime over the MCP server's SDK wire against ${ENGINE_IMAGE}`, () => {
  let engine: RunningEngine | undefined
  let suite: Suite | undefined

  beforeAll(async () => {
    engine = await startEngine()
    const harness = {
      runtime: runtimeAt("conformance", engine.url),
      unreachableRuntime: runtimeAt("unreachable", UNREACHABLE_URL),
      world: await seedWorld(engine.url),
    }
    suite = { url: engine.url, harness }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  const prepared = (): Suite => {
    if (suite === undefined) throw new Error("the engine did not start")
    return suite
  }

  new ConformanceKit(test).registerRuntimeLaws(() =>
    Promise.resolve().then(() => prepared().harness),
  )

  test("board: the feed's build of c7-core's recorded board reads every tile, with the numbers of the kit's world", async () => {
    const data = await buildBoardData(RECORDED_BOARD, boardEngineAt(prepared().url))
    const fake = await BoardBuilder.build(RECORDED_BOARD.board, [
      { name: C7_BOARD_ENGINE.engine, reads: new FakeEngine(FakeWorld.seed().state) },
    ])
    const expected = BoardJson.of(fake, { failureOf: () => ({ code: "unexpected" }), notes: [] })
    expect(data.engines.map(({ state }) => state)).toEqual(["ready"])
    expect(figuresOf(data)).toEqual(figuresOf(expected))
    // The recording still holds what the engine answers; else record it again from this world.
    expect(figuresOf(data)).toEqual(figuresOf(C7_BOARD_ENGINE.expected as BoardData))
  })

  test("board: the cockpit's With incident chip of a process counts what the board's counter counts", async () => {
    const resolve = boardEngineAt(prepared().url)
    const data = await buildBoardData(RECORDED_BOARD, resolve)
    const counter = data.rows
      .flat()
      .find(
        (tile) =>
          tile.kind === "counter" &&
          tile.widget.filter.process === WORLD_PROCESS.order &&
          tile.widget.filter.withIncident === true,
      )
    const instances = await buildProcessInstancesData(
      resolve(C7_BOARD_ENGINE.engine).client,
      C7_BOARD_ENGINE.engine,
      { processDefinitionKey: WORLD_PROCESS.order },
    )
    expect(instances.withIncidentCount).toBeGreaterThan(0)
    expect(counter).toMatchObject({ total: { count: instances.withIncidentCount } })
  })

  test("bulk: a batch that cancels one instance reads as such, from the runtime, then the history", async () => {
    const { url, harness } = prepared()
    const { runtime, world } = harness
    const id = await startCancellation(url, world)
    const first = await runtime.getBulkOperation(id)
    expect(first).toMatchObject({ id, kind: "cancelInstances", total: 1 })
    expect(["running", "ended"]).toContain(first?.state)
    expect(await runtime.getBulkFailures(id)).toEqual([])
    const deadline = Date.now() + BATCH_RUNS_WITHIN_MS
    let ended = first
    while (ended?.state !== "ended" && Date.now() < deadline) {
      await wait(500)
      ended = await runtime.getBulkOperation(id)
    }
    expect(ended).toMatchObject({ id, kind: "cancelInstances", state: "ended", total: 1 })
    expect(ended?.endedAt).toEqual(expect.any(String))
    expect(await runtime.getBulkFailures(id)).toEqual([])
  })

  test("bulk: an id the engine does not know reads as none, without failures", async () => {
    const { runtime, world } = prepared().harness
    expect(await runtime.getBulkOperation(world.unknown.bulkOperationId)).toBeUndefined()
    expect(await runtime.getBulkFailures(world.unknown.bulkOperationId)).toEqual([])
  })
})
