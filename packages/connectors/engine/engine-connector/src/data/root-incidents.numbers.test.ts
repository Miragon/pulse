/**
 * The same incident numbers on the chat's cockpit and the web app's shared screens (owner decision
 * D2, amended on 2026-11-19, the chat following on 2026-11-21): over c7-core's recorded screen
 * engine (`C7_SCREEN_ENGINE`, the conformance world on Operaton, with a call chain: DSP-3001 of
 * pulse-dispatch waits at its call activity for the root incident of the instance of pulse-label it
 * called, so Camunda 7 holds a copy of that incident at the call activity), the cockpit's overview,
 * process route and process flow's "Running" count what the engine screen and the process screens
 * count, the engine screen's column "Incidents" (the contract's `incidents`, from the statistics
 * with `rootIncidents=true` the recording holds) among them. The cockpit reads what the screens'
 * recording holds no answer to (the statistics with the jobs without retries, a key's versions and
 * counts, its incident scan, a version's jobs without retries): those answers are this world's as
 * the engine gives them, derived below from the
 * recorded answers (`COCKPIT_ANSWERS`: the root incidents and failed jobs from the recorded
 * incidents by c7-core's rule, and from the incidents a version's recorded statistics count at an
 * element whose incidents no screen reads, since it is no call activity), and the engine answers no
 * request beside them.
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
  readonly incidents: ReadonlyArray<{ readonly incidentCount: number }>
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

interface RecordedIncident {
  readonly id: string
  readonly processDefinitionId: string
  readonly processInstanceId?: string
  readonly activityId: string
  readonly incidentType: string
  readonly incidentTimestamp?: string
  readonly rootCauseIncidentId?: string | null
}

interface RecordedElement {
  readonly id: string
  readonly incidents: ReadonlyArray<{
    readonly incidentType: string
    readonly incidentCount: number
  }>
}

interface RecordedInstance {
  readonly id: string
  readonly definitionId: string
}

/** Every open incident the recording read (at a call activity, by instance), once each. */
const RECORDED_INCIDENTS: readonly RecordedIncident[] = [
  ...new Map(
    RECORDED.answers
      .filter((answer) => answer.path === `${ROOT}/incident` && "answer" in answer)
      .flatMap((answer) => ("answer" in answer ? (answer.answer as RecordedIncident[]) : []))
      .map((incident) => [incident.id, incident] as const),
  ).values(),
]

/** The running instances with an open incident, as the runtime lists them. */
const WITH_INCIDENT = answerAt(`${ROOT}/process-instance`, {
  withIncident: "true",
  sortBy: "instanceId",
}) as RecordedInstance[]

/** A version's element statistics with its incidents, as its process screen read them; none unread. */
const elementsOf = (definitionId: string): RecordedElement[] =>
  RECORDED.answers.some(
    (answer) =>
      answer.path === `${ROOT}/process-definition/${definitionId}/statistics` &&
      answer.query?.incidents === "true",
  )
    ? (answerAt(`${ROOT}/process-definition/${definitionId}/statistics`, {
        incidents: "true",
      }) as RecordedElement[])
    : []

/**
 * A version's open incidents as the engine lists them: each the recording read, and for every
 * further incident its statistics count at an element (one that is no call activity, whose
 * incidents no screen reads, since all of them are root incidents), a root incident of its own
 * there, held by the version's instance with an incident.
 */
function incidentsOf(definitionId: string): RecordedIncident[] {
  const read = RECORDED_INCIDENTS.filter((i) => i.processDefinitionId === definitionId)
  const holder = WITH_INCIDENT.find((instance) => instance.definitionId === definitionId)?.id
  const further = elementsOf(definitionId).flatMap((element) =>
    element.incidents.flatMap(({ incidentType, incidentCount }) => {
      const known = read.filter(
        (i) => i.activityId === element.id && i.incidentType === incidentType,
      ).length
      return Array.from({ length: Math.max(0, incidentCount - known) }, (_, at) => {
        const id = `${definitionId}:${element.id}:${String(at)}`
        return {
          id,
          processDefinitionId: definitionId,
          ...(holder === undefined ? {} : { processInstanceId: holder }),
          activityId: element.id,
          incidentType,
          incidentTimestamp: RECORDED.asOf.replace("Z", "+0000"),
          rootCauseIncidentId: id,
        }
      })
    }),
  )
  return [...read, ...further]
}

/**
 * A version's open root incidents, as the engine counts them with `rootIncidents=true`: its
 * incidents that name themselves their root (c7-core's rule, `isRootIncident`), so a change of the
 * recording reaches the cockpit's answers and the screens alike. pulse-dispatch holds the copy of
 * pulse-label's at its call activity, which the engine does not count as a root.
 */
const rootIncidentsIn = (definitionId: string, activityId?: string) =>
  incidentsOf(definitionId).filter(
    (incident) =>
      (activityId === undefined || incident.activityId === activityId) && isRootIncident(incident),
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

/** The statistics with the root incidents and each version's jobs without retries. */
function rootStatistics(): unknown[] {
  return STATISTICS.map((row) => ({
    ...row,
    failedJobs: failedJobsOf(row.id),
    incidents: rootsByType(row.id),
  }))
}

/** The root incidents the recorded statistics count per process, over its versions. */
const recordedRootsOf = (key: string) =>
  STATISTICS.filter((row) => row.definition.key === key)
    .flatMap((row) => row.incidents)
    .reduce((sum, type) => sum + type.incidentCount, 0)

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
        { failedJobs: "true", incidents: "true" },
        elementsOf(version.id).map((row) => ({
          ...row,
          failedJobs: failedJobsOf(version.id, row.id),
        })),
      ),
    ),
  ]
}

const COCKPIT_ANSWERS: RecordedAnswer[] = [
  get(
    "/process-definition/statistics",
    { failedJobs: "true", rootIncidents: "true" },
    rootStatistics(),
  ),
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
    // The engine screen's column "Incidents" counts what the cockpit's overview counts, per process.
    for (const process of screen.processes) {
      expect(process.incidents, process.bpmnProcessId).toBe(incidents(process.bpmnProcessId))
      expect(process.incidents, process.bpmnProcessId).toBe(recordedRootsOf(process.bpmnProcessId))
    }
    expect(screen.processes.map((row) => [row.bpmnProcessId, row.incidents])).toEqual([
      ["pulse-order", 1],
      ["pulse-dispatch", 0],
      ["pulse-label", 1],
    ])
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
