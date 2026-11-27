import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { bootServer, type BootedServer } from "../boot-server.js"
import { assertGolden, GOLDEN_DIR, UPDATE_COMMAND } from "../golden.js"
import { NOW } from "./goldens.js"
import { type MediumEngines, type SentOperation, startMediumEngines } from "./medium-engines.js"
import { mediumRoutes } from "./medium-routes.js"
import { instanceIdOf, MediumWorld } from "./medium-world.js"

/**
 * The request-count golden (#691, T-request-golden): how many requests each read of the server
 * sends an engine of the size the reads must hold up on, per operation of the REST API. Every read
 * tool of the default toolset (the read-only floor, whose reads the operations toolset shares),
 * every `*_data` feed of the cockpit and the web app's screens and a board is called once, each on
 * a server booted for it alone (`createApp`), so every floor and cache starts empty, against the
 * medium engines (medium-world.ts, its laws in medium-world.test.ts): five of them, the default
 * `prod-1` with 304 versions of 31 processes, 28,909 running instances, 3,344 open root incidents
 * (3,492 with the copies call activities hold) and 212,003 ended instances, the others with fewer
 * processes, for the board and the fleet. The fleet is the cockpit landscape's reads, each
 * engine's overview, job backlog and health, in one server, as one view reads them, so a floor the
 * three share shows. Under the goldens' fixed clock and in UTC, so no count depends on when it
 * runs. The world answers each read as asked or the call fails: a route it lacks, a parameter it
 * would ignore (an order too, since a capped page's rows depend on it) and an answer of 400 or
 * more where the call is not meant to read a missing object. The golden is one file,
 * `__golden__/request-counts.json`, written only by
 * `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`: a change that
 * sends more requests (or fewer) fails here, naming the call, the engine, the operation and both
 * numbers, until the golden is updated and its diff justified in the pull request.
 */

const GOLDEN = "request-counts"

/** The engines: each one's number of processes besides billing. */
const SHAPES: Readonly<Record<string, number>> = {
  "prod-1": 30,
  "prod-2": 24,
  "prod-3": 18,
  "prod-4": 12,
  "prod-5": 6,
}

const DEFAULT = "prod-1"
const world = new MediumWorld({ keys: SHAPES[DEFAULT] })

/**
 * What the calls read on `prod-1`: process-28, which calls billing, in its 19 versions; on its
 * latest version the instance n=5 waits at callBilling on a billing instance whose charge failed
 * (so it holds a copy of that root incident), n=6 has its own charge failed, n=0 waits at review.
 */
const PROCESS = "process-28"
const LATEST = world.versionsOf(PROCESS)[0]
const INSTANCE = instanceIdOf(LATEST, 5)
const FAILED = instanceIdOf(LATEST, 6)
const CALLED = instanceIdOf(world.billing, world.calledBy(LATEST, 5))
const REVIEW = instanceIdOf(LATEST, 0)

/** Each call by its name in the golden: the tool, a variant after a colon where it has more. */
const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["engine_activity_counts", { processDefinitionKey: PROCESS }],
  ["engine_activity_incidents_data", { processDefinitionKey: PROCESS, activityId: "charge" }],
  ["engine_activity_statistics_data", { processDefinitionKey: PROCESS, source: "runtime" }],
  ["engine_activity_statistics_data:history", { processDefinitionKey: PROCESS, source: "history" }],
  ["engine_board_data", { board: "fleet" }],
  ["engine_bpmn_xml_data", { processDefinitionId: LATEST.id }],
  ["engine_cluster_detail_data", { activityId: "charge", incidentType: "failedJob" }],
  ["engine_cockpit_overview_data", {}],
  ["engine_format_incident_issue", { incidentId: `inc-${FAILED}` }],
  ["engine_get_board", { board: "fleet" }],
  ["engine_get_deployment", { deploymentId: LATEST.deploymentId }],
  ["engine_get_job_stacktrace", { jobId: `job-${FAILED}` }],
  ["engine_get_process_definition_xml", { processDefinitionId: LATEST.id }],
  ["engine_get_process_instance_variables", { processInstanceId: INSTANCE }],
  ["engine_get_screen", { screen: "engine" }],
  ["engine_get_screen:process", { screen: "process", processDefinitionKey: PROCESS }],
  ["engine_get_screen:instance", { screen: "instance", processInstanceId: INSTANCE }],
  ["engine_get_task", { taskId: `task-${REVIEW}` }],
  ["engine_get_task_form", { taskId: `task-${REVIEW}` }],
  ["engine_get_task_variables", { taskId: `task-${REVIEW}` }],
  ["engine_health_data", {}],
  ["engine_history_timeline_data", { processInstanceId: INSTANCE }],
  ["engine_incident_detail_data", { incidentId: `inc-${FAILED}` }],
  ["engine_incidents_data", {}],
  ["engine_inspect_process_instance", { processInstanceId: INSTANCE }],
  ["engine_instance_detail_data", { processInstanceId: INSTANCE }],
  ["engine_job_backlog_data", {}],
  ["engine_jobs_data", {}],
  ["engine_list_deployments", {}],
  ["engine_list_engines", {}],
  ["engine_list_external_tasks", {}],
  ["engine_list_incidents", {}],
  ["engine_list_jobs", {}],
  ["engine_list_process_definitions", {}],
  ["engine_list_process_instances", {}],
  ["engine_list_tasks", {}],
  ["engine_open_cockpit", {}],
  ["engine_process_incidents_data", { processDefinitionKey: PROCESS }],
  ["engine_process_instances_data", { processDefinitionKey: PROCESS }],
  ["engine_process_stats", { processDefinitionKey: PROCESS, bucket: "day" }],
  ["engine_query_historic_activity_instances", {}],
  ["engine_query_historic_incidents", {}],
  ["engine_query_historic_process_instances", {}],
  ["engine_query_historic_task_instances", {}],
  ["engine_query_historic_variable_instances", {}],
  ["engine_screen_find_data", { text: `bk-${INSTANCE}` }],
  ["engine_screen_incident_text_data", { incident: `inc-${CALLED}` }],
  ["engine_screen_instance_data", { instance: INSTANCE }],
  ["engine_screen_instances_data", { definitionId: LATEST.id, scope: "running" }],
  ["engine_screen_process_data", { process: PROCESS }],
  ["engine_screen_processes_data", {}],
  ["engine_screen_variable_names_data", { definitionId: LATEST.id }],
  ["engine_screen_verdict_data", {}],
  ["engine_status", {}],
  ["engine_widget_actions_data", {}],
]

/** The feeds the cockpit's fleet landscape reads for each engine, in one view. */
const FLEET = ["engine_cockpit_overview_data", "engine_job_backlog_data", "engine_health_data"]

/** The board every engine shows: counters, the incident summary and list, a diagram, a list. */
const BOARD = {
  schemaVersion: 1,
  title: "Fleet",
  engines: Object.keys(SHAPES),
  rows: [
    {
      row: [
        {
          widget: "counter",
          props: { title: "In review", filter: { process: "process-04", activeElement: "review" } },
        },
        {
          widget: "counter",
          props: { title: "With incident", filter: { process: "process-04", withIncident: true } },
        },
        { widget: "incidentSummary", props: { groupBy: "process" } },
      ],
    },
    {
      row: [
        { widget: "processDiagram", props: { process: "process-04" } },
        { widget: "incidentList", props: { process: "process-04" } },
      ],
    },
    {
      row: [
        {
          widget: "instanceList",
          props: { title: "In review", filter: { process: "process-04", activeElement: "review" } },
        },
      ],
    },
  ],
}

/** Requests per engine and operation, both sorted, and their total. */
interface Counted {
  total: number
  requests: Record<string, Record<string, number>>
}

function countedOf(sent: readonly SentOperation[]): Counted {
  const requests: Record<string, Record<string, number>> = {}
  for (const { engine, operation } of sent) {
    const ofEngine = (requests[engine] ??= {})
    ofEngine[operation] = (ofEngine[operation] ?? 0) + 1
  }
  return { total: sent.length, requests }
}

/**
 * The operations by which a call is meant to read an object the engine does not hold, so their
 * answer of 404 is the one it reads: none today. Every other answer of 400 or more fails the call,
 * since a read that falls back where the world wrongly says "none" would pin its fallback's
 * requests in the golden.
 */
const MEANT_MISSING: Readonly<Record<string, readonly string[]>> = {}

/**
 * What the world could not answer as asked in `call`: a route it lacks, an answer that failed
 * where the call was not meant to read a missing object, a parameter it ignored.
 */
function unanswered(sent: readonly SentOperation[], call: string): string[] {
  const missing = MEANT_MISSING[call] ?? []
  const problems = sent.flatMap(({ engine, operation, status, unread }) => {
    if (operation.startsWith("unanswered:")) return [`${engine} ${operation}`]
    return [
      ...(status >= 400 && !missing.includes(operation)
        ? [`${engine} ${operation} answered ${status}`]
        : []),
      ...(unread.length > 0 ? [`${engine} ${operation} ignores ${unread.join(", ")}`] : []),
    ]
  })
  return [...new Set(problems)].sort()
}

const UNANSWERED =
  "extend medium-routes.ts so the world answers it, or name the 404 in MEANT_MISSING"

const textOf = (result: unknown) =>
  ((result as { content?: Array<{ text?: string }> }).content ?? [])
    .map((part) => part.text)
    .join("")

let engines: MediumEngines
let boards: string

/** The server over the five engines, `prod-1` the default, with the board. */
const boot = () =>
  bootServer({
    env: {
      ENGINES_JSON: JSON.stringify({
        profiles: Object.fromEntries(
          Object.keys(SHAPES).map((id) => [id, { url: engines.urlOf(id), flavor: "cibseven" }]),
        ),
      }),
      ENGINE_DEFAULT: DEFAULT,
      ENGINE_BOARDS_DIR: boards,
      // Every boot's, since closing one restores the env.
      TZ: "UTC",
    },
  })

/** Calls `tool` on `server`; a failed call fails the test. */
async function callOk(server: BootedServer, tool: string, args: Record<string, unknown>) {
  const result = await server.client.callTool({ name: tool, arguments: args })
  expect(result.isError, `${tool} failed: ${textOf(result)}`).not.toBe(true)
}

const goldenFile = path.join(GOLDEN_DIR, `${GOLDEN}.json`)
const golden = (
  fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, "utf8")) : { calls: {} }
) as { calls: Record<string, Counted>; fleet?: Counted }
const updating = process.env.GOLDEN_UPDATE === "1"

/** Each difference of `actual` from the golden's `expected`, as `<engine> <operation>: a, was b`. */
function differences(actual: Counted, expected: Counted | undefined): string[] {
  const engineIds = new Set([
    ...Object.keys(actual.requests),
    ...Object.keys(expected?.requests ?? {}),
  ])
  return [...engineIds].sort().flatMap((engine) => {
    const now = actual.requests[engine] ?? {}
    const before = expected?.requests[engine] ?? {}
    return [...new Set([...Object.keys(now), ...Object.keys(before)])]
      .sort()
      .filter((operation) => now[operation] !== before[operation])
      .map(
        (operation) =>
          `${engine} ${operation}: ${now[operation] ?? 0}, was ${before[operation] ?? 0}`,
      )
  })
}

/** Holds a call's counts to the golden's, unless the golden is being written. */
function expectAsGolden(name: string, actual: Counted, expected: Counted | undefined) {
  if (updating) return
  const changed = differences(actual, expected)
  expect(
    changed,
    `${name} sends other requests than the golden holds (${UPDATE_COMMAND} if intended)`,
  ).toEqual([])
}

const measured: { calls: Record<string, Counted>; fleet?: Counted } = { calls: {} }

beforeAll(async () => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  boards = fs.mkdtempSync(path.join(os.tmpdir(), "request-counts-"))
  fs.writeFileSync(path.join(boards, "fleet.board.json"), JSON.stringify(BOARD))
  engines = await startMediumEngines(
    Object.fromEntries(
      Object.entries(SHAPES).map(([id, keys]) => [id, mediumRoutes(new MediumWorld({ keys }))]),
    ),
  )
})

afterAll(async () => {
  await engines?.close()
  fs.rmSync(boards, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the requests each read sends a medium engine", () => {
  it("calls every read tool and feed of the default toolset", async () => {
    const server = await boot()
    try {
      const { tools } = await server.client.listTools()
      const called = new Set(CALLS.map(([name]) => name.split(":")[0]))
      expect(tools.map(({ name }) => name).sort()).toEqual([...called].sort())
    } finally {
      await server.close()
    }
  })

  it.each(CALLS)("%s", async (name, args) => {
    const server = await boot()
    try {
      engines.reset()
      await callOk(server, name.split(":")[0], args)
    } finally {
      await server.close()
    }
    expect(unanswered(engines.sent, name), UNANSWERED).toEqual([])
    const counted = countedOf(engines.sent)
    measured.calls[name] = counted
    expectAsGolden(name, counted, golden.calls[name])
  })

  it("the fleet: each engine's overview, job backlog and health in one view", async () => {
    const server = await boot()
    try {
      engines.reset()
      for (const engine of Object.keys(SHAPES)) {
        for (const feed of FLEET) await callOk(server, feed, { engine })
      }
    } finally {
      await server.close()
    }
    expect(unanswered(engines.sent, "the fleet"), UNANSWERED).toEqual([])
    measured.fleet = countedOf(engines.sent)
    expectAsGolden("the fleet", measured.fleet, golden.fleet)
  })

  it("holds them all in one golden", () => {
    // A run of some calls alone (`-t`) writes no golden of those alone.
    expect(Object.keys(measured.calls).sort()).toEqual(CALLS.map(([name]) => name).sort())
    expect(measured.fleet).toBeDefined()
    assertGolden(GOLDEN, {
      about:
        "Engine requests per call and operation against the medium engines of " +
        "test/engine-goldens/medium-world.ts; written by golden:update only.",
      ...measured,
    })
  })
})
