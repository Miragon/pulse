/**
 * The engine contract's conformance kit over the MCP server's SDK wire: the runtime the server
 * runs (`runtimeOf`, c7-core's `C7Runtime` on the connector's engine port over
 * `createEngineConnection`, the client every tool sends through, its failures read by
 * `runtimeErrorOf`), against a real engine of the
 * Camunda 7 REST family in a container (`PULSE_ENGINE_IMAGE`, Operaton 2.1.5 without one; CI runs
 * Operaton and CIB seven; it skips on a Camunda 8 image, which c8-runtime.engine.test.ts runs, and
 * fails on an image of neither: engine-image.test-support.ts), seeded with the kit's world through
 * c7-core's `seedC7World`. The read
 * laws hold here as on the C7 adapter's wire, the unreachable engine at 127.0.0.1:9 included. No
 * law reads a bulk operation, so two cases of this suite do: a batch it starts itself, and an id
 * the engine does not know. c7-core's recorded board (`C7_BOARD_ENGINE`), built by the board
 * feed's builder over the seeded world, shows every tile read, with the numbers the kit's fake
 * world gives and its recording holds, and the cockpit's "With incident" chip of a process (the
 * instance list's POST count) counts what the board's counter of that process (the runtime's GET
 * count) counts. The counts with the jobs without retries ("Running"), from one statistics read with
 * `failedJobs` and `incidents`, are the contract's counts and the jobs the engine counts without
 * `incidents`. A process's numbers (`engine_process_stats`, `engine_activity_counts`) count what
 * the history and the runtime hold, as the cockpit counts them (process-numbers.test-support.ts).
 * Under a search the cockpit's "With incident" chip counts and lists the search's matches the
 * runtime holds an open incident for, as the engine answers them (cockpit-search.test-support.ts).
 *
 * `pnpm --fail-if-no-match --filter @miragon/pulse-engine-connector test:engines` (Docker); its
 * own container start, since no package shares a Node test helper with another.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
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
  type SeededWorld,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
} from "@miragon/pulse-engine-core/testing"
import { buildBoardData } from "../../data/board-data.js"
import { buildProcessInstancesData } from "../../data/cockpit-data.js"
import { buildEngineHealthData } from "../../data/health-data.js"
import { buildEngineVerdictData } from "../../data/screens/verdict-data.js"
import { providerForEntry } from "../../providers/index.js"
import { createEngineConnection } from "../engine/engine-connection.js"
import { c7RuntimeOf, runtimeOf } from "../engine/engine-runtime.js"
import {
  createEngineRegistry,
  type ResolvedEngine,
  resolveEngine,
} from "../engine/resolve-engine.js"
import { engineStatusForModel } from "./composites.js"
import { fakeWorldBoard, recordedBoard } from "./compared-boards.test-support.js"
import { engineImageOf } from "./engine-image.test-support.js"
import { COCKPIT_SEARCH_CHECKS } from "./cockpit-search.test-support.js"
import { PROCESS_NUMBER_CHECKS } from "./process-numbers.test-support.js"

const ENGINE_IMAGE = engineImageOf(process.env.PULSE_ENGINE_IMAGE)
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
  const container = await new GenericContainer(ENGINE_IMAGE.name)
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
      `${ENGINE_IMAGE.name} runs its example application: disable it in ENGINE_ENVIRONMENT`,
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
const ENGINE_FLAVOR = ENGINE_IMAGE.dialect === "c7" ? ENGINE_IMAGE.flavor : "operaton"

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
const RECORDED_BOARD = recordedBoard(C7_BOARD_ENGINE)

/** The engine the recorded board names, at `url`, as the server resolves an engine by name. */
function boardEngineAt(url: string): (name: string) => ResolvedEngine {
  const registry = createEngineRegistry(
    [{ id: C7_BOARD_ENGINE.engine, baseUrl: url, flavor: ENGINE_FLAVOR }],
    (entry) => providerForEntry(entry).createClient(entry, { type: "none" }),
  )
  return (name) => resolveEngine(name, registry)
}

/** The jobs without retries per element that hold one, as `rows` count them. */
function failedJobsOf(
  rows: readonly { readonly element: string; readonly failedJobs: number }[],
): Record<string, number> {
  return Object.fromEntries(
    rows
      .filter(({ failedJobs }) => failedJobs > 0)
      .map(({ element, failedJobs }) => [element, failedJobs]),
  )
}

/** The seeded engine and the kit's harness over it. */
interface Suite {
  readonly url: string
  readonly harness: ConformanceHarness
}

describe.skipIf(ENGINE_IMAGE.dialect !== "c7")(
  `c7-core's runtime over the MCP server's SDK wire against ${ENGINE_IMAGE.name}`,
  () => {
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
      expect(data.engines.map(({ state }) => state)).toEqual(["ready"])
      expect(BoardFigures.of(data)).toEqual(BoardFigures.of(await fakeWorldBoard(C7_BOARD_ENGINE)))
      // The recording still holds what the engine answers; else record it again from this world.
      expect(BoardFigures.of(data)).toEqual(BoardFigures.of(C7_BOARD_ENGINE.expected as BoardData))
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

    test("statistics: the counts with the jobs without retries are the contract's counts, and the engine's jobs without incidents", async () => {
      const { url, harness } = prepared()
      const entry = { id: "conformance", baseUrl: url, flavor: ENGINE_FLAVOR }
      const runtime = c7RuntimeOf(createEngineConnection(entry, { type: "none" }))
      const byElement = <T extends { readonly elementId: string }>(rows: readonly T[]) =>
        [...rows].sort((left, right) => left.elementId.localeCompare(right.elementId))
      let failedJobs = 0
      for (const id of Object.values(harness.world.definitionIds)) {
        const [withJobs, counts, alone] = await Promise.all([
          runtime.getElementStatisticsWithFailedJobs(id),
          runtime.getElementStatistics(id),
          rest(`${url}/process-definition/${id}/statistics?failedJobs=true`),
        ])
        const contract = withJobs.map(
          ({ elementId, active, incidents, incidentsInCalledInstances }) => ({
            elementId,
            active,
            incidents,
            incidentsInCalledInstances,
          }),
        )
        expect(byElement(contract), id).toEqual(byElement(counts))
        const engineRows = (alone as { id: string; failedJobs: number }[]).map((row) => ({
          element: row.id,
          failedJobs: row.failedJobs,
        }))
        const read = withJobs.map((row) => ({ element: row.elementId, failedJobs: row.failedJobs }))
        expect(failedJobsOf(read), id).toEqual(failedJobsOf(engineRows))
        failedJobs += read.reduce((sum, row) => sum + row.failedJobs, 0)
      }
      // The world holds jobs without retries, so the case reads some.
      expect(failedJobs).toBeGreaterThan(0)
    })

    test("verdict: engine_status, the health feed and the verdict feed count the world's root incidents, never its copy", async () => {
      const { url } = prepared()
      const engine = boardEngineAt(url)(C7_BOARD_ENGINE.engine)
      const all = ((await rest(`${url}/incident/count`)) as { count: number }).count
      const rows = (await rest(`${url}/process-definition/statistics?rootIncidents=true`)) as {
        incidents: { incidentCount: number }[]
      }[]
      const roots = rows
        .flatMap(({ incidents }) => incidents)
        .reduce((sum, { incidentCount }) => sum + incidentCount, 0)
      // The world's dispatch waits for the label it called: Camunda 7 copies its incident there.
      expect(all).toBeGreaterThan(roots)
      // Critical by every open incident, the copy included; by the root incidents not.
      const thresholds = { criticalIncidents: all, criticalClusterSize: 99 }
      const [status, health, verdict] = await Promise.all([
        engineStatusForModel(engine.client, {}, engine.engineId, thresholds),
        buildEngineHealthData(engine.client, engine.engineId, thresholds),
        buildEngineVerdictData(engine, thresholds),
      ])
      expect(status).toMatchObject({
        status: "warning",
        rootIncidentsTotal: roots,
        incidentsTotal: all,
      })
      expect([health.status, health.summary.totalIncidents]).toEqual(["warning", roots])
      expect(verdict).toEqual({ status: "warning" })
    })

    for (const [name, check] of [...PROCESS_NUMBER_CHECKS, ...COCKPIT_SEARCH_CHECKS]) {
      test(name, () => check(prepared().url, boardEngineAt(prepared().url)(C7_BOARD_ENGINE.engine)))
    }

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
  },
)
