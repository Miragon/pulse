/**
 * The honest-numbers tables' harness and the degrade table. Each case builds against the fake
 * engine's world with at most one read broken (`build`); honest-numbers.test.ts holds the
 * builders that fail when a primary read fails, honest-numbers.degrade.test.ts the ones that show
 * a failure in its place, and the first checks that both tables together name every builder of
 * src/data.
 */

import { expect } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { toEngineDate } from "@miragon/pulse-c7-core"
import { BoardParser, type TileData } from "@miragon/pulse-board"
import type { EngineBoard } from "../board-files.js"
import { createEngineRegistry, resolveEngine } from "../lib/engine/resolve-engine.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_FAILURE, readOf, WORLD, worldReply } from "../tools/test-support/engine-world.js"
import {
  clientFor,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import type { BoardStartData } from "../view-models.board.js"
import type { CockpitStart } from "../view-models.js"
import { type BoardEngineResolver, buildBoardData } from "./board-data.js"
import { buildCockpitStart } from "./cockpit-start.js"

/** A builder run against the world, with its overrides of the world's answers. */
export interface BuildCase {
  run: (client: Client, baseUrl: string) => Promise<unknown>
  world?: (request: RecordedRequest) => FakeReply | undefined
}

/** A case of the rejection table (honest-numbers.test.ts): a build and the reads it may lose. */
export interface Case extends BuildCase {
  /** The lookup of the id/key the builder is asked about, answering "nothing there". */
  unknown?: { read: string; reply: FakeReply }
  /** Enrichment reads: each failure leaves the build intact, with the read's value null. */
  enrichment?: Record<string, (data: never) => unknown>
  /**
   * Fallback reads: each failure is answered by the read it names, with the same figures (a
   * version's diagram, which c7-core's element statistics read for its call activities, by a read
   * of every incident of the version).
   */
  fallback?: Record<string, string>
}

const engines: FakeEngine[] = []

/** Closes the engines of the builds so far: each test file's `afterEach`. */
export async function closeBuildEngines(): Promise<void> {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
}

/** The case's engine: the world plus its overrides, with at most one read broken. */
function engineReply(builder: BuildCase, broken?: { read: string; reply: FakeReply }) {
  return (request: RecordedRequest): FakeReply =>
    broken && readOf(request) === broken.read
      ? broken.reply
      : (builder.world?.(request) ?? worldReply(request))
}

/** The outcome of a build and the reads it made. */
export async function build(builder: BuildCase, broken?: { read: string; reply: FakeReply }) {
  const engine = await startFakeEngine({}, engineReply(builder, broken))
  engines.push(engine)
  const result = builder.run(clientFor(engine), engine.baseUrl)
  // Settle before reading the recorded requests; the caller asserts the outcome.
  const outcome = await result.then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  return { outcome, reads: new Set(engine.requests.map(readOf)) }
}

// A board's numbers degrade per engine and tile instead of failing the call (invariant 7): EVERY
// read of a healthy build is declared with the place its figure shows, and broken in turn. The
// build resolves, that place is left out (the engine failed, a count or a group not read, never a
// 0), and no figure of the build turns 0.

export interface DegradeCase extends BuildCase {
  /** Every read of the healthy build, and where its figure shows in the data. */
  places: Record<string, (data: never) => unknown>
}

/** A board over the world's one engine, `fake`, with one tile of each kind, one per row. */
const WORLD_BOARD: EngineBoard = (() => {
  const parsed = BoardParser.parse(
    JSON.stringify({
      title: "Orders",
      engines: ["fake"],
      rows: [
        {
          widget: "counter",
          props: { filter: { process: WORLD.key, activeElement: WORLD.activityId } },
        },
        { widget: "instanceList", props: { filter: { process: WORLD.key } } },
        { widget: "incidentSummary", props: { groupBy: "process" } },
        { widget: "processDiagram", props: { process: WORLD.key } },
        { widget: "incidentList" },
      ].map((widget) => ({ row: [widget] })),
    }),
  )
  if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
  return { id: "orders", file: "orders.board.json", board: parsed.board, notes: [] }
})()

/** WORLD_BOARD as a board of its own: each call a new owner of the board feed's builds. */
export const worldBoard = (): EngineBoard => ({ ...WORLD_BOARD })

/** The board feed's resolver over the world's one engine, `fake`, at `baseUrl`. */
export function worldResolver(baseUrl: string): BoardEngineResolver {
  const registry = createEngineRegistry([{ id: "fake", baseUrl }], (entry) =>
    providerForEntry(entry).createClient(entry, { type: "none" }),
  )
  return (name) => resolveEngine(name, registry)
}

/** The tile of `kind` in its row of WORLD_BOARD. */
function tileOf<Kind extends TileData["kind"]>(data: BoardStartData, kind: Kind) {
  const tile = data.rows.flat().find((each) => each.kind === kind)
  return tile as Extract<TileData, { kind: Kind }> | undefined
}

const engineOf = (data: BoardStartData) => {
  const [engine] = data.engines
  return engine?.state === "ready" ? engine : undefined
}
const listGroup = (data: BoardStartData) => tileOf(data, "instanceList")?.groups[0]

/** Every read of WORLD_BOARD's healthy build, and where its figure shows in the board's data. */
const BOARD_PLACES: Record<string, (data: BoardStartData) => unknown> = {
  // What the engine is: when it fails to say, the engine is failed and asked nothing else.
  "GET /telemetry/data": (data: BoardStartData) => engineOf(data)?.product,
  // The definitions with their root incidents and flags: the engine's totals (and the summary, the
  // diagram's version).
  "GET /process-definition/statistics?rootIncidents": (data: BoardStartData) =>
    engineOf(data)?.totals,
  "GET /process-instance?firstResult&maxResults&sortBy&sortOrder&withIncident": (
    data: BoardStartData,
  ) => engineOf(data)?.totals,
  "POST /history/process-instance/count {activityIdIn,processDefinitionKey,unfinished}": (
    data: BoardStartData,
  ) => tileOf(data, "counter")?.total,
  // The list's page, the runtime's incident flags of its rows, and its total.
  "POST /history/process-instance?firstResult&maxResults {processDefinitionKey,sorting,unfinished}":
    (data: BoardStartData) => listGroup(data)?.instances,
  "GET /process-instance?firstResult&maxResults&processInstanceIds&withIncident": (
    data: BoardStartData,
  ) => listGroup(data)?.instances,
  "POST /history/process-instance/count {processDefinitionKey,unfinished}": (
    data: BoardStartData,
  ) => listGroup(data)?.total,
  // The diagram's badges: its counts per element with every incident there, the incidents at its
  // call activity behind them, its XML (which names the call activity).
  [`GET /process-definition/${WORLD.latestDefinitionId}/statistics?incidents`]: (
    data: BoardStartData,
  ) => tileOf(data, "processDiagram")?.badges,
  "GET /incident?activityId&firstResult&maxResults&processDefinitionId&sortBy&sortOrder": (
    data: BoardStartData,
  ) => tileOf(data, "processDiagram")?.badges,
  [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: BoardStartData) =>
    tileOf(data, "processDiagram")?.badges,
  "GET /incident?firstResult&maxResults&sortBy&sortOrder": (data: BoardStartData) =>
    tileOf(data, "incidentList")?.groups[0]?.incidents,
}

/** The board's places in the start data of `engine_open_cockpit` view `board`. */
const START_PLACES = Object.fromEntries(
  Object.entries(BOARD_PLACES).map(([read, place]) => [
    read,
    (start: CockpitStart) => place(start.data as BoardStartData),
  ]),
)

export const DEGRADE: Record<string, DegradeCase> = {
  buildBoardData: {
    run: (_client, baseUrl) => buildBoardData(worldBoard(), worldResolver(baseUrl)),
    places: BOARD_PLACES,
  },
  // The cockpit's board route starts from the board feed: its start shows each failure in place.
  "buildCockpitStart (board)": {
    run: (_client, baseUrl) =>
      buildCockpitStart(
        { section: "board", board: "orders" },
        { resolve: worldResolver(baseUrl), boards: { boards: [worldBoard()], refused: [] } },
      ),
    places: START_PLACES,
  },
}

/** The JSON paths of `value` that hold a 0, but a total's count of engines (`known`). */
export function zerosOf(value: unknown, at = ""): string[] {
  if (value === 0) return /\.known$/.test(at) ? [] : [at]
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => zerosOf(inner, `${at}.${key}`))
}

/** The read of every incident of a version, by id: c7-core's whole read. */
const WHOLE_READ = "GET /incident?firstResult&maxResults&processDefinitionId&sortBy&sortOrder"

/** v1's diagram, which the element statistics alone read (v1 holds a root incident), and its fallback. */
export const V1_CALL_ACTIVITIES = {
  [`GET /process-definition/${WORLD.instanceDefinitionId}/xml`]: WHOLE_READ,
}

/** Each build's own: when it read, the engine's address and the times the scan stamps now. */
const OWN_PER_BUILD = new Set(["fetchedAt", "asOf", "cockpitUrl", "firstSeen", "latestIncident"])

/** An outcome's figures, without what each build has of its own. */
function figuresOf(outcome: unknown): unknown {
  return JSON.parse(
    JSON.stringify(outcome, (key, value: unknown) => (OWN_PER_BUILD.has(key) ? undefined : value)),
  )
}

/** Breaks each fallback read in turn: the build reads the one it names, with the same figures. */
export async function expectFallbacks(
  builder: BuildCase,
  fallback: Readonly<Record<string, string>>,
): Promise<void> {
  const healthy = await build(builder)
  expect([...healthy.reads]).toEqual(expect.arrayContaining(Object.keys(fallback)))
  for (const [read, replacement] of Object.entries(fallback)) {
    const broken = await build(builder, { read, reply: ENGINE_FAILURE })
    expect([...broken.reads], read).toContain(replacement)
    expect(figuresOf(broken.outcome), read).toEqual(figuresOf(healthy.outcome))
  }
}

/** `count` open incidents at the world's activity of v1, all raised now, as a key's scan lists them. */
export function incidentScan(count: number): unknown[] {
  const now = toEngineDate(new Date())
  return Array.from({ length: count }, (_, n) => ({
    id: `inc-scan-${n}`,
    processDefinitionId: WORLD.instanceDefinitionId,
    processInstanceId: WORLD.instanceId,
    activityId: WORLD.activityId,
    incidentType: "failedJob",
    incidentMessage: "card declined",
    incidentTimestamp: now,
    configuration: WORLD.jobId,
  }))
}
