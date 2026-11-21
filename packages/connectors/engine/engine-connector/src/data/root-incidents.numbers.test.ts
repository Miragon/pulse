/**
 * The same incident numbers on the chat's cockpit and the web app's shared screens (owner decision
 * D2, amended on 2026-11-19, the chat following on 2026-11-21): over c7-core's recorded screen
 * engine (`C7_SCREEN_ENGINE`, the conformance world on Operaton, with a call chain: DSP-3001 of
 * pulse-dispatch waits at its call activity for the root incident of the instance of pulse-label it
 * called, so Camunda 7 holds a copy of that incident at the call activity), the cockpit's overview,
 * process route and process flow's "Running" count what the engine screen and the process screens
 * count. The cockpit reads what the screens' recording holds no answer to (the statistics with
 * `rootIncidents=true`, a key's versions and counts, its incident scan, a version's jobs without
 * retries): those answers are this world's as the engine gives them, derived below from the
 * recorded answers (`COCKPIT_ANSWERS`: the root incidents and failed jobs from the recorded
 * incidents by c7-core's rule), and the engine answers no request beside them.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { isRootIncident } from "@miragon/pulse-c7-core"
import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import {
  type RecordedAnswer,
  type RecordedEngine,
  startRecordedEngine,
} from "@miragon/pulse-http/testing/loopback"
import type { ElementBadgeData, EngineScreenData, ProcessScreenData } from "@miragon/pulse-screens"
import { engineModule } from "../module.js"
import {
  ENGINE_ACTIVITY_STATISTICS_DATA,
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
} from "../tool-names.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type {
  ActivityStatisticsData,
  CockpitDashboardData,
  ProcessIncidentsData,
} from "../view-models.js"

const ROOT = "/engine-rest"
const RECORDED = C7_SCREEN_ENGINE

interface RecordedDefinition {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly version: number
}

interface RecordedStatistics {
  readonly id: string
  readonly instances: number
  readonly definition: RecordedDefinition
}

/** The recorded answer to `path` (and the query's values `where` names). */
function answerAt(path: string, where: Record<string, string> = {}): unknown {
  const found = RECORDED.answers.find(
    (answer) =>
      answer.path === path &&
      Object.entries(where).every(([name, value]) => answer.query?.[name] === value),
  )
  if (found === undefined || !("answer" in found)) throw new Error(`no recorded answer at ${path}`)
  return found.answer
}

/** Every version the engine deploys, as its statistics list them: three processes, four versions. */
const STATISTICS = answerAt(`${ROOT}/process-definition/statistics`) as RecordedStatistics[]

/** A version's open incidents, as the recording read them whole for its process screen. */
const incidentsOf = (definitionId: string) =>
  answerAt(`${ROOT}/incident`, { processDefinitionId: definitionId }) as unknown[]

interface RecordedIncident {
  readonly id: string
  readonly processDefinitionId: string
  readonly activityId: string
  readonly incidentType: string
  readonly rootCauseIncidentId?: string | null
}

/** Every open incident the recording read (by version and by instance), once each. */
const RECORDED_INCIDENTS: readonly RecordedIncident[] = [
  ...new Map(
    RECORDED.answers
      .filter((answer) => answer.path === `${ROOT}/incident` && "answer" in answer)
      .flatMap((answer) => ("answer" in answer ? (answer.answer as RecordedIncident[]) : []))
      .map((incident) => [incident.id, incident] as const),
  ).values(),
]

/**
 * A version's open root incidents, as the engine counts them with `rootIncidents=true`: the
 * recorded incidents that name themselves their root (c7-core's rule, `isRootIncident`), so a
 * change of the recording reaches the cockpit's answers and the screens alike. pulse-dispatch holds
 * the copy of pulse-label's at its call activity, which the engine does not count as a root.
 */
const rootIncidentsIn = (definitionId: string, activityId?: string) =>
  RECORDED_INCIDENTS.filter(
    (incident) =>
      incident.processDefinitionId === definitionId &&
      (activityId === undefined || incident.activityId === activityId) &&
      isRootIncident(incident),
  )

/** A version's jobs without retries (at an element): its root incidents of failed jobs. */
const failedJobsOf = (definitionId: string, activityId?: string) =>
  rootIncidentsIn(definitionId, activityId).filter((i) => i.incidentType === "failedJob").length

/** A version's root incidents per type, as the statistics list them. */
function rootsByType(definitionId: string): Array<{ incidentType: string; incidentCount: number }> {
  const byType = new Map<string, number>()
  for (const incident of rootIncidentsIn(definitionId)) {
    byType.set(incident.incidentType, (byType.get(incident.incidentType) ?? 0) + 1)
  }
  return [...byType].map(([incidentType, incidentCount]) => ({ incidentType, incidentCount }))
}

const versionsOf = (key: string) =>
  STATISTICS.filter((row) => row.definition.key === key)
    .map((row) => row.definition)
    .sort((a, b) => b.version - a.version)

/** The statistics with the root incidents, with each version's jobs without retries where asked. */
function rootStatistics(failedJobs: boolean): unknown[] {
  return STATISTICS.map((row) => ({
    ...row,
    failedJobs: failedJobs ? failedJobsOf(row.id) : 0,
    incidents: rootsByType(row.id),
  }))
}

const get = (
  path: string,
  query: Record<string, string> | undefined,
  answer: unknown,
): RecordedAnswer => ({ method: "GET", path: `${ROOT}${path}`, query, answer })

/** What the cockpit reads of a key beyond the screens' reads, as the engine answers it. */
function keyAnswers(key: string): RecordedAnswer[] {
  const versions = versionsOf(key)
  const latest = { sortBy: "version", sortOrder: "desc" }
  return [
    get("/process-definition", { key, latestVersion: "true", ...latest, maxResults: "1" }, [
      versions[0],
    ]),
    get("/process-definition", { key, ...latest }, versions),
    get(
      "/process-instance/count",
      { processDefinitionKey: key },
      {
        count: STATISTICS.filter((row) => row.definition.key === key).reduce(
          (sum, row) => sum + row.instances,
          0,
        ),
      },
    ),
    get(
      "/job/count",
      { processDefinitionKey: key, noRetriesLeft: "true" },
      { count: versions.reduce((sum, version) => sum + failedJobsOf(version.id), 0) },
    ),
    get(
      "/incident",
      {
        processDefinitionKeyIn: key,
        maxResults: "200",
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
      },
      versions.flatMap((version) => incidentsOf(version.id)),
    ),
    // Each version's activity statistics with its jobs without retries: a root incident's job.
    ...versions.map((version) =>
      get(
        `/process-definition/${version.id}/statistics`,
        { failedJobs: "true" },
        (
          answerAt(`${ROOT}/process-definition/${version.id}/statistics`) as Array<{ id: string }>
        ).map((row) => ({ ...row, failedJobs: failedJobsOf(version.id, row.id) })),
      ),
    ),
  ]
}

const COCKPIT_ANSWERS: RecordedAnswer[] = [
  get(
    "/process-definition/statistics",
    { failedJobs: "true", rootIncidents: "true" },
    rootStatistics(true),
  ),
  get("/process-definition/statistics", { rootIncidents: "true" }, rootStatistics(false)),
  ...keyAnswers("pulse-order"),
  ...keyAnswers("pulse-dispatch"),
]

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The server over the recorded engine and the cockpit's answers, and a call of one of its feeds. */
async function boot() {
  const engine = await startRecordedEngine([...RECORDED.answers, ...COCKPIT_ANSWERS])
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [RECORDED.engine]: { url: `${engine.origin}${ROOT}`, flavor: "operaton" } },
    }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const feed = recording.tool(name)
    const input = (feed.config.inputSchema as z.ZodObject).parse({
      engine: RECORDED.engine,
      ...args,
    })
    return feedPayload<T>(await feed.call(input))
  }
  return { engine, call }
}

/** A process screen of the recording, as its feed builds it. */
const screenOf = (
  call: Awaited<ReturnType<typeof boot>>["call"],
  name: "process" | "olderVersion" | "callingProcess",
) => {
  const expected = RECORDED.expected[name] as ProcessScreenData
  return call<ProcessScreenData>(ENGINE_SCREEN_PROCESS_DATA, {
    process: expected.bpmnProcessId,
    ...(name === "olderVersion" ? { version: expected.selected?.version } : {}),
  })
}

/** The badges of a key's versions summed per element, as the cockpit sums its versions. */
function summed(...screens: ProcessScreenData[]): ElementBadgeData[] {
  const byElement = new Map<string, ElementBadgeData>()
  for (const badge of screens.flatMap((screen) => screen.badges)) {
    const sum = byElement.get(badge.elementId)
    byElement.set(badge.elementId, {
      elementId: badge.elementId,
      running: (sum?.running ?? 0) + badge.running,
      incidents: (sum?.incidents ?? 0) + badge.incidents,
      incidentsInCalledInstances:
        (sum?.incidentsInCalledInstances ?? 0) + badge.incidentsInCalledInstances,
    })
  }
  return [...byElement.values()]
}

const rootIncidentsOf = (badges: readonly ElementBadgeData[]) =>
  badges.reduce((sum, badge) => sum + badge.incidents, 0)

const byElement = (rows: ReadonlyArray<readonly [string, ...number[]]>) =>
  [...rows].sort((a, b) => a[0].localeCompare(b[0], "en"))

describe("the cockpit counts what the shared screens count, over c7-core's recorded screen engine", () => {
  it("the overview: each process's running instances and root incidents, the copy at a call activity none", async () => {
    const { engine, call } = await boot()
    const screen = await call<EngineScreenData>(ENGINE_SCREEN_PROCESSES_DATA)
    const overview = await call<CockpitDashboardData>(ENGINE_COCKPIT_OVERVIEW_DATA)
    const [order, older, dispatch] = await Promise.all([
      screenOf(call, "process"),
      screenOf(call, "olderVersion"),
      screenOf(call, "callingProcess"),
    ])

    expect(engine.unanswered).toEqual([])
    const definitions = new Map(overview.definitions.map((row) => [row.key, row]))
    for (const process of screen.processes) {
      expect(definitions.get(process.bpmnProcessId), process.bpmnProcessId).toMatchObject({
        instances: process.running,
        latestVersion: process.latestVersion,
      })
    }
    expect(overview.summary.totalRunningInstances).toBe(screen.totals.running)
    const incidents = (key: string) =>
      (definitions.get(key)?.incidents ?? []).reduce((sum, row) => sum + row.incidentCount, 0)
    // pulse-order's one root incident lies on its version 1; pulse-dispatch's call activity holds a
    // copy of pulse-label's, which counts in pulse-label alone: one incident in the chain, not two.
    expect(incidents("pulse-order")).toBe(rootIncidentsOf(summed(order, older)))
    expect(incidents("pulse-dispatch")).toBe(rootIncidentsOf(dispatch.badges))
    expect(incidents("pulse-dispatch")).toBe(0)
    expect(dispatch.badges.map((badge) => badge.incidentsInCalledInstances)).toEqual([1])
    expect(overview.summary.totalIncidents).toBe(2)
  })

  it("the process route: a key's root incidents and their activities, as its versions' screens", async () => {
    const { engine, call } = await boot()
    const [order, older, dispatch] = await Promise.all([
      screenOf(call, "process"),
      screenOf(call, "olderVersion"),
      screenOf(call, "callingProcess"),
    ])
    const route = (key: string) =>
      call<ProcessIncidentsData>(ENGINE_PROCESS_INCIDENTS_DATA, { processDefinitionKey: key })
    const failing = (badges: readonly ElementBadgeData[]) =>
      byElement(
        badges
          .filter((badge) => badge.incidents > 0)
          .map((b) => [b.elementId, b.incidents] as const),
      )

    const orderRoute = await route("pulse-order")
    const dispatchRoute = await route("pulse-dispatch")

    expect(engine.unanswered).toEqual([])
    expect(orderRoute.incidentCount).toBe(rootIncidentsOf(summed(order, older)))
    expect(
      byElement(orderRoute.activities.map((a) => [a.activityId, a.incidentCount] as const)),
    ).toEqual(failing(summed(order, older)))
    expect(dispatchRoute.incidentCount).toBe(rootIncidentsOf(dispatch.badges))
    expect(dispatchRoute.activities).toEqual([])
  })

  it("the process flow's Running: each element's tokens, root incidents and incidents in called instances", async () => {
    const { engine, call } = await boot()
    const [order, older, dispatch] = await Promise.all([
      screenOf(call, "process"),
      screenOf(call, "olderVersion"),
      screenOf(call, "callingProcess"),
    ])
    const running = (key: string) =>
      call<ActivityStatisticsData>(ENGINE_ACTIVITY_STATISTICS_DATA, {
        processDefinitionKey: key,
        source: "runtime",
      })
    const counts = (rows: ReadonlyArray<{ activityId?: string; elementId?: string } & Counts>) =>
      byElement(
        rows.map((row) => [
          row.activityId ?? row.elementId ?? "",
          row.running,
          row.incidents,
          row.incidentsInCalledInstances,
        ]),
      )

    const orderFlow = await running("pulse-order")
    const dispatchFlow = await running("pulse-dispatch")

    expect(engine.unanswered).toEqual([])
    expect(counts(orderFlow.activities)).toEqual(counts(summed(order, older)))
    expect(counts(dispatchFlow.activities)).toEqual(counts(dispatch.badges))
  })
})

interface Counts {
  readonly running: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}
