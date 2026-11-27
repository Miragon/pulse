import { readdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import {
  BARE_DEFINITION_ID,
  ENGINE_FAILURE,
  onBareDefinitionId,
  WORLD,
} from "../tools/test-support/engine-world.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "./cockpit-data.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { INCIDENT_SCAN_LIMIT } from "./engine-reads.js"
import { HEALTH_CASES } from "./honest-numbers.health.test-support.js"
import { buildHistoryTimelineData } from "./history-timeline-data.js"
import { buildIncidentDetailData } from "./incident-detail-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildInstanceDetailData } from "./instance-detail-data.js"
import { buildActivityIncidentsData, buildProcessIncidentsData } from "./process-incidents-data.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import { buildJobBacklogData } from "./job-backlog-data.js"
import { PROCESS_NUMBER_CASES } from "./honest-numbers.process-numbers.test-support.js"
import {
  build,
  type Case,
  closeBuildEngines,
  DEGRADE,
  expectFallbacks,
  incidentScan,
  V1_CALL_ACTIVITIES,
} from "./honest-numbers.test-support.js"
import { COPY_CASES, HISTORY_ENRICHMENT } from "./honest-numbers.copies.test-support.js"

// Each case declares only its enrichment and fallback reads; EVERY other read its
// healthy build makes is primary and broken in turn, so a newly swallowed failure
// fails here without anyone listing it. A builder without a case fails structurally.

afterEach(closeBuildEngines)

const urls = (baseUrl: string) => ({ baseUrl, provider: cibsevenProvider })

const KEY_LOOKUP = "GET /process-definition?key&latestVersion&maxResults&sortBy&sortOrder"
/** Another process with a root incident, unnamed, so its diagram names it (enrichment). */
const SHIP_STATS = {
  id: "ship:1:s1",
  instances: 1,
  failedJobs: 0,
  incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
  definition: { id: "ship:1:s1", key: "ship", name: null, version: 1 },
}
const NOT_FOUND = { status: 404, body: { type: "InvalidRequestException", message: "not found" } }
const NO_ROWS = { body: [] }

const processIncidents: Case["run"] = (client, baseUrl) =>
  buildProcessIncidentsData(client, { ...urls(baseUrl), processDefinitionKey: WORLD.key })
const processIncidentsXml = {
  [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: {
    diagramDefinitionId: unknown
  }) => data.diagramDefinitionId,
}
const clusterDetail: Case["run"] = (client) =>
  buildClusterDetailData(client, "fake", {
    activityId: WORLD.activityId,
    incidentType: "failedJob",
  })
const clusterBusinessKeys = {
  "GET /process-instance?maxResults&processInstanceIds": (data: {
    incidents: Array<{ businessKey: unknown }>
  }) => data.incidents[0]?.businessKey,
}
/** The diagram that names a view's activity and processes (`fetchNamesByDefinition`). */
const namesFrom = (definitionId: string) => `GET /process-definition/${definitionId}/xml`
const clusterNames = {
  ...clusterBusinessKeys,
  [namesFrom(WORLD.instanceDefinitionId)]: (data: { activityName: unknown }) => data.activityName,
}
const incidentDetailEnrichment = {
  [`GET /process-definition/${WORLD.instanceDefinitionId}`]: (data: {
    processDefinitionName: unknown
  }) => data.processDefinitionName,
  [`GET /process-definition/${WORLD.instanceDefinitionId}/xml`]: (data: {
    diagramDefinitionId: unknown
  }) => data.diagramDefinitionId,
  [`GET /job/${WORLD.jobId}/stacktrace`]: (data: { job: { stacktrace: unknown } }) =>
    data.job.stacktrace,
}

// The diagram names the elements and says which of them it draws.
const activityStatistics = (source: "runtime" | "history"): Case => ({
  run: (client) => buildActivityStatisticsData(client, { processDefinitionKey: WORLD.key, source }),
  unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
  enrichment: {
    [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: {
      activities: Array<{ inDiagram: unknown; activityName: unknown }>
    }) => data.activities[0]?.inDiagram ?? data.activities[0]?.activityName,
  },
  ...(source === "runtime" ? { fallback: V1_CALL_ACTIVITIES } : {}),
})
const HISTORY_OPEN = "GET /history/process-instance?maxResults&unfinished"
const recorded = (data: { historyRecorded: unknown }) => data.historyRecorded
/** When each instance of the page started: one history read over the page's ids. */
const instanceStarts = {
  "POST /history/process-instance?maxResults {processInstanceIds}": (data: {
    instances: Array<{ startTime: unknown }>
  }) => data.instances[0]?.startTime,
}
/** The instance list on the world's key, with a chip on or none. */
const instancesOf = (args: { withIncidents?: boolean; suspended?: boolean }): Case => ({
  run: (client) =>
    buildProcessInstancesData(client, "fake", { processDefinitionKey: WORLD.key, ...args }),
  unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
  enrichment: instanceStarts,
})

const CASES: Record<string, Case> = {
  buildCockpitDashboardData: {
    run: (client) => buildCockpitDashboardData(client, "fake"),
  },
  buildProcessInstancesData: instancesOf({}),
  // Each chip shows its count whichever chip is on: with a chip on, All's is a read of its own.
  "buildProcessInstancesData (With incident chip)": instancesOf({ withIncidents: true }),
  "buildProcessInstancesData (Suspended chip)": instancesOf({ suspended: true }),
  // Engine-wide rows on a bare definition id: their keys (the process
  // column's drill) resolve through the statistics (enrichment).
  "buildProcessInstancesData (engine-wide, bare definition ids)": {
    run: (client) => buildProcessInstancesData(client, "fake", {}),
    world: onBareDefinitionId("/process-instance", [
      { id: WORLD.instanceId, definitionId: BARE_DEFINITION_ID, suspended: false },
    ]),
    enrichment: {
      ...instanceStarts,
      "GET /process-definition/statistics?rootIncidents": (data: {
        instances: Array<{ processDefinitionKey: unknown }>
      }) => data.instances[0]?.processDefinitionKey,
      // The rows' process names (#322 U13): one read over the page's versions.
      "GET /process-definition?maxResults&processDefinitionIdIn": (data: {
        instances: Array<{ processDefinitionName: unknown }>
      }) => data.instances[0]?.processDefinitionName,
    },
  },
  buildJobPanelData: {
    run: (client) => buildJobPanelData(client, "fake", { processDefinitionKey: WORLD.key }),
    unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
    enrichment: {
      [namesFrom(WORLD.instanceDefinitionId)]: (data: {
        jobs: Array<{ activityName: unknown; processDefinitionName: unknown }>
      }) => data.jobs[0]?.activityName ?? data.jobs[0]?.processDefinitionName,
    },
  },
  buildInstanceDetailData: {
    run: (client) =>
      buildInstanceDetailData(client, "fake", { processInstanceId: WORLD.instanceId }),
    unknown: { read: `GET /process-instance/${WORLD.instanceId}`, reply: NOT_FOUND },
    enrichment: {
      // The diagram, and the name of each incident's element read from it.
      [`GET /process-definition/${WORLD.instanceDefinitionId}/xml`]: (data: {
        diagramDefinitionId: unknown
        incidents: Array<{ activityName: unknown }>
      }) => data.diagramDefinitionId ?? data.incidents[0]?.activityName,
      // Its caller and its start, from its history (none on history level none).
      ...HISTORY_ENRICHMENT,
    },
  },
  // A bare definition id names no key: that one definition's row resolves it (enrichment, never
  // the engine-wide statistics), and with it the process's name and the header's drill; a failed
  // read leaves the key null, never the UUID.
  "buildInstanceDetailData (bare definition id)": {
    run: (client) =>
      buildInstanceDetailData(client, "fake", { processInstanceId: WORLD.instanceId }),
    world: onBareDefinitionId(`/process-instance/${WORLD.instanceId}`, {
      id: WORLD.instanceId,
      definitionId: BARE_DEFINITION_ID,
    }),
    enrichment: {
      "GET /process-definition?maxResults&processDefinitionIdIn": (data: {
        definitionKey: unknown
        processDefinitionName: unknown
      }) => data.definitionKey ?? data.processDefinitionName,
      [namesFrom(BARE_DEFINITION_ID)]: (data: {
        diagramDefinitionId: unknown
        processDefinitionName: unknown
        incidents: Array<{ activityName: unknown }>
      }) =>
        data.diagramDefinitionId ?? data.processDefinitionName ?? data.incidents[0]?.activityName,
      ...HISTORY_ENRICHMENT,
    },
  },
  buildHistoryTimelineData: {
    run: (client) =>
      buildHistoryTimelineData(client, "fake", { processInstanceId: WORLD.instanceId }),
    enrichment: {
      // The failing steps the timeline marks.
      "GET /incident?maxResults&processInstanceId": (data: { incidentActivityIds: unknown }) =>
        data.incidentActivityIds,
    },
  },
  // The overview and the cockpit's start on it.
  ...HEALTH_CASES,
  buildClusterDetailData: { run: clusterDetail, enrichment: clusterNames },
  // The cluster's keys scope its remediation: a bare definition id resolves
  // through the statistics, and that read is primary: never a guessed key.
  "buildClusterDetailData (bare definition ids)": {
    run: clusterDetail,
    world: onBareDefinitionId(
      "/incident",
      incidentScan(1).map((i) => ({
        ...(i as Record<string, unknown>),
        processDefinitionId: BARE_DEFINITION_ID,
      })),
    ),
    enrichment: {
      ...clusterBusinessKeys,
      [namesFrom(BARE_DEFINITION_ID)]: (data: { activityName: unknown }) => data.activityName,
    },
  },
  // A mass failure: the scan hits its limit, so the counts come from /count.
  "buildClusterDetailData (scan capped)": {
    run: clusterDetail,
    world: (r) => (r.path === "/incident" ? { body: incidentScan(CLUSTER_SCAN_LIMIT) } : undefined),
    enrichment: clusterNames,
  },
  buildIncidentDetailData: {
    run: (client, baseUrl) =>
      buildIncidentDetailData(client, { ...urls(baseUrl), incidentId: WORLD.incidentId }),
    unknown: { read: `GET /incident/${WORLD.incidentId}`, reply: NOT_FOUND },
    enrichment: incidentDetailEnrichment,
  },
  // The root cause decides which job and message the view shows (primary).
  "buildIncidentDetailData (delegated incident)": {
    run: (client, baseUrl) =>
      buildIncidentDetailData(client, {
        ...urls(baseUrl),
        incidentId: WORLD.delegatedIncidentId,
      }),
    unknown: { read: `GET /incident/${WORLD.delegatedIncidentId}`, reply: NOT_FOUND },
    enrichment: incidentDetailEnrichment,
  },
  buildIncidentsDashboardData: {
    run: (client, baseUrl) =>
      buildIncidentsDashboardData(client, { ...urls(baseUrl), processDefinitionKey: WORLD.key }),
    // The statistics list every deployed key: a key they lack is not deployed.
    unknown: { read: "GET /process-definition/statistics?rootIncidents", reply: NO_ROWS },
    enrichment: {
      // An activity's row is named in the diagram of its newest incident's version.
      [namesFrom(WORLD.instanceDefinitionId)]: (data: {
        processes: Array<{ activities: Array<{ activityName: unknown }> }>
      }) => data.processes[0]?.activities[0]?.activityName,
    },
  },
  buildProcessIncidentsData: {
    run: processIncidents,
    unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
    enrichment: processIncidentsXml,
  },
  // More incidents than the scan holds: per-activity counts from the statistics.
  "buildProcessIncidentsData (scan capped)": {
    run: processIncidents,
    world: (r) =>
      r.path === "/incident" && r.query.processDefinitionKeyIn !== undefined
        ? { body: incidentScan(INCIDENT_SCAN_LIMIT) }
        : undefined,
    enrichment: processIncidentsXml,
    fallback: V1_CALL_ACTIVITIES,
  },
  // No root incidents: the empty state names the other processes that have some, from the
  // statistics the count reads (primary), their names enrichment.
  "buildProcessIncidentsData (no incidents)": {
    run: processIncidents,
    world: (r) =>
      r.path === "/process-definition/statistics"
        ? { body: [SHIP_STATS] }
        : r.path === "/incident"
          ? NO_ROWS
          : undefined,
    enrichment: {
      ...processIncidentsXml,
      [namesFrom("ship:1:s1")]: (data: {
        siblingsWithIncidents: Array<{ processDefinitionName: unknown }> | null
      }) => data.siblingsWithIncidents?.[0]?.processDefinitionName ?? null,
    },
  },
  buildActivityIncidentsData: {
    run: (client, baseUrl) =>
      buildActivityIncidentsData(client, {
        ...urls(baseUrl),
        processDefinitionKey: WORLD.key,
        activityId: WORLD.activityId,
      }),
    unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
    enrichment: {
      // The rows are named by their instances' business keys (#322 U13).
      "GET /process-instance?maxResults&processInstanceIds": (data: {
        incidents: Array<{ businessKey: unknown }>
      }) => data.incidents[0]?.businessKey,
      // The latest diagram names the element; unread, the page reads the activity whole, since
      // it cannot tell a call activity, and its rows stay the same.
      [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: {
        incidents: Array<{ activityName: unknown }>
      }) => data.incidents[0]?.activityName,
    },
  },
  // A call activity's copies: an instance's copy's root incident and its element's name are
  // enrichment; an activity's page at a call activity reads its incidents whole.
  ...COPY_CASES,
  // Every version's statistics are primary: a version left out would undercount the key.
  buildActivityStatisticsData: activityStatistics("runtime"),
  // "Throughput": the counts pick the versions and the window, the statistics are the figures.
  "buildActivityStatisticsData (history)": activityStatistics("history"),
  // Nothing started in the window: whether the engine writes history at all is enrichment.
  "buildActivityStatisticsData (history, nothing started)": {
    run: activityStatistics("history").run,
    world: (r) =>
      r.path === "/history/process-instance/count" ? { body: { count: 0 } } : undefined,
    enrichment: { "GET /process-instance?maxResults": recorded, [HISTORY_OPEN]: recorded },
  },
  // The cross-engine landscape's backlog: four counts, each a figure on screen, none enrichment.
  buildJobBacklogData: { run: (client) => buildJobBacklogData(client) },
  // A process's numbers, ready to show (#665).
  ...PROCESS_NUMBER_CASES,
}

/**
 * The tests that build once per read, each build on a fake engine of its own: up to a quarter of a
 * second here and twenty times that on the CI runner, where `pnpm test` runs every package's suite
 * at once (a case of `buildProcessStatsData` ran past the 5 s default there, main, 2026-11-24).
 */
const PER_READ = { timeout: 30_000 }

describe.each(Object.entries(CASES))("%s", (_name, builder) => {
  const enrichment = builder.enrichment ?? {}
  const fallback = builder.fallback ?? {}

  it("builds from a healthy engine, reading every declared enrichment", async () => {
    const { outcome, reads } = await build(builder)
    expect(outcome.ok ? null : String(outcome.error)).toBeNull()
    // A stale declaration would exempt a read the builder no longer makes.
    expect([...reads]).toEqual(expect.arrayContaining(Object.keys(enrichment)))
    expect([...reads].filter((read) => !(read in enrichment)).length).toBeGreaterThan(0)
  })

  it("fails (never a confident 0 or []) when ANY primary read fails", PER_READ, async () => {
    const { reads } = await build(builder)
    const primary = [...reads].filter((read) => !(read in enrichment) && !(read in fallback))
    const broken = await Promise.all(
      primary.map(async (read) => ({
        read,
        ...(await build(builder, { read, reply: ENGINE_FAILURE })),
      })),
    )
    // Each broken read was actually made: the case pins a real dependency.
    for (const { read, reads: made } of broken) expect(made).toContain(read)
    expect(
      broken.filter(({ outcome }) => outcome.ok).map(({ read }) => read),
      "primary reads whose failure the builder swallowed",
    ).toEqual([])
  })

  it.runIf(Object.keys(enrichment).length > 0)(
    "degrades each failed enrichment read to null",
    PER_READ,
    async () => {
      const degraded = await Promise.all(
        Object.entries(enrichment).map(async ([read, value]) => ({
          read,
          value,
          ...(await build(builder, { read, reply: ENGINE_FAILURE })),
        })),
      )
      for (const { read, value, outcome } of degraded) {
        expect(outcome.ok ? null : String(outcome.error), read).toBeNull()
        if (outcome.ok) expect(value(outcome.data as never), read).toBeNull()
      }
    },
  )

  it.runIf(Object.keys(fallback).length > 0)(
    "answers each failed fallback read by the read it names, with the same figures",
    PER_READ,
    () => expectFallbacks(builder, fallback),
  )

  it.runIf(builder.unknown)("fails on an unknown id instead of reporting zeros", async () => {
    const { outcome, reads } = await build(builder, builder.unknown)
    expect(outcome.ok).toBe(false)
    expect(reads).toContain(builder.unknown!.read)
  })
})

// The chips' counts are figures on screen: reads of their own (`readOf` tells their bodies apart),
// so the table above breaks each of them alone, whichever chip is on.
it.each(["", " (With incident chip)", " (Suspended chip)"])(
  "buildProcessInstancesData%s counts All, With incident and Suspended apart",
  async (variant) => {
    const { reads } = await build(CASES[`buildProcessInstancesData${variant}`])
    const counts = [...reads].filter((read) => read.startsWith("POST /process-instance/count"))
    expect(counts.sort()).toEqual(
      [",suspended", ",withIncident", ""].map(
        (flag) => `POST /process-instance/count {processDefinitionKey${flag}}`,
      ),
    )
  },
)

/**
 * The completeness check imports every module of src/data: 0.3 s alone, up to 2.5 s on the CI
 * runner, where `pnpm test` runs every package's suite at once on four cores.
 */
const EVERY_MODULE = { timeout: 30_000 }

describe("the rejection and degrade tables are complete", () => {
  it("name every data builder exported from src/data", EVERY_MODULE, async () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const modules = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    const builders: string[] = []
    for (const file of modules) {
      const exports = (await import(`./${file.replace(/\.ts$/, ".js")}`)) as Record<string, unknown>
      builders.push(
        ...Object.entries(exports)
          .filter(([name, value]) => /^build[A-Z]/.test(name) && typeof value === "function")
          .map(([name]) => name),
      )
    }
    // A variant case ("buildX (scan capped)") covers the same builder, and so does a case of the
    // degrade table.
    const named = [...Object.keys(CASES), ...Object.keys(DEGRADE)]
    const covered = new Set(named.map((name) => name.split(" ")[0]))
    expect(builders.sort()).toEqual([...covered].sort())
  })
})
