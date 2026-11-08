import { readdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import type { Client } from "@miragon/pulse-engine-client"
import { toEngineDate } from "@miragon/pulse-engine-core"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import {
  BARE_DEFINITION_ID,
  ENGINE_FAILURE,
  onBareDefinitionId,
  readOf,
  WORLD,
  worldReply,
} from "../tools/test-support/engine-world.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "./cockpit-data.js"
import { buildCockpitStart } from "./cockpit-start.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { INCIDENT_SCAN_LIMIT } from "./engine-reads.js"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-engine-core"
import { buildEngineHealthData } from "./health-data.js"
import { buildHistoryTimelineData } from "./history-timeline-data.js"
import { buildIncidentDetailData } from "./incident-detail-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildInstanceDetailData } from "./instance-detail-data.js"
import { buildActivityIncidentsData, buildProcessIncidentsData } from "./process-incidents-data.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import { buildJobBacklogData } from "./job-backlog-data.js"

// Each case declares only its enrichment reads; EVERY other read its healthy
// build makes is primary and broken in turn, so a newly swallowed failure fails
// here without anyone listing it. A builder without a case fails structurally.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const urls = (baseUrl: string) => ({ baseUrl, provider: cibsevenProvider })

interface Case {
  run: (client: Client, baseUrl: string) => Promise<unknown>
  world?: (request: RecordedRequest) => FakeReply | undefined
  /** The lookup of the id/key the builder is asked about, answering "nothing there". */
  unknown?: { read: string; reply: FakeReply }
  /** Enrichment reads: each failure leaves the build intact, with the read's value null. */
  enrichment?: Record<string, (data: never) => unknown>
}

const KEY_LOOKUP = "GET /process-definition?key&latestVersion&maxResults&sortBy&sortOrder"
const NOT_FOUND = { status: 404, body: { type: "InvalidRequestException", message: "not found" } }
const NO_ROWS = { body: [] }

function incidentScan(count: number): unknown[] {
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
  "GET /history/activity-instance/count?processInstanceId": (data: {
    historyTotalCount: unknown
  }) => data.historyTotalCount,
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
})
const HISTORY_OPEN = "GET /history/process-instance?maxResults&unfinished"
const recorded = (data: { historyRecorded: unknown }) => data.historyRecorded
/** The instance list on the world's key, with a chip on or none. */
const instancesOf = (args: { withIncidents?: boolean; suspended?: boolean }): Case => ({
  run: (client) =>
    buildProcessInstancesData(client, "fake", { processDefinitionKey: WORLD.key, ...args }),
  unknown: { read: KEY_LOOKUP, reply: NO_ROWS },
})

const CASES: Record<string, Case> = {
  buildCockpitDashboardData: {
    run: (client) => buildCockpitDashboardData(client, "fake"),
  },
  buildProcessInstancesData: instancesOf({}),
  // Each chip shows its count whichever chip is on: with a chip on, All's is a read of its own.
  "buildProcessInstancesData (With incidents chip)": instancesOf({ withIncidents: true }),
  "buildProcessInstancesData (Suspended chip)": instancesOf({ suspended: true }),
  // Engine-wide rows on a bare definition id: their keys (the process
  // column's drill) resolve through the statistics (enrichment).
  "buildProcessInstancesData (engine-wide, bare definition ids)": {
    run: (client) => buildProcessInstancesData(client, "fake", {}),
    world: onBareDefinitionId("/process-instance", [
      { id: WORLD.instanceId, definitionId: BARE_DEFINITION_ID, suspended: false },
    ]),
    enrichment: {
      "GET /process-definition/statistics?incidents": (data: {
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
  buildEngineHealthData: {
    run: (client) => buildEngineHealthData(client, "fake"),
    enrichment: {
      "GET /history/process-instance/count?startedAfter": (data: {
        summary: { started24h: unknown }
      }) => data.summary.started24h,
      "GET /history/process-instance/count?finishedAfter": (data: {
        summary: { completed24h: unknown }
      }) => data.summary.completed24h,
      // The clusters are titled by their activity's name (#322 U12).
      [namesFrom(WORLD.instanceDefinitionId)]: (data: {
        clusters: Array<{ activityName: unknown }>
      }) => data.clusters[0]?.activityName,
    },
  },
  // The cockpit's start view: the overview reads the health verdict and the definitions table.
  "buildCockpitStart (overview)": {
    run: (client, baseUrl) =>
      buildCockpitStart(
        { section: "overview" },
        { client, engineId: "fake", ...urls(baseUrl) },
        DEFAULT_VERDICT_THRESHOLDS,
      ),
    enrichment: {
      "GET /history/process-instance/count?startedAfter": (data: {
        data: { health: { summary: { started24h: unknown } } }
      }) => data.data.health.summary.started24h,
      "GET /history/process-instance/count?finishedAfter": (data: {
        data: { health: { summary: { completed24h: unknown } } }
      }) => data.data.health.summary.completed24h,
      [namesFrom(WORLD.instanceDefinitionId)]: (data: {
        data: { health: { clusters: Array<{ activityName: unknown }> } }
      }) => data.data.health.clusters[0]?.activityName,
    },
  },
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
    unknown: { read: "GET /process-definition/statistics?incidents", reply: NO_ROWS },
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
      r.path === "/incident" ? { body: incidentScan(INCIDENT_SCAN_LIMIT) } : undefined,
    enrichment: processIncidentsXml,
  },
  // No incidents: the empty state reads the other processes (enrichment).
  "buildProcessIncidentsData (no incidents)": {
    run: processIncidents,
    world: (r) =>
      r.path === "/incident/count"
        ? { body: { count: 0 } }
        : r.path === "/incident"
          ? NO_ROWS
          : undefined,
    enrichment: {
      ...processIncidentsXml,
      "GET /process-definition/statistics?incidents": (data: { siblingsWithIncidents: unknown }) =>
        data.siblingsWithIncidents,
    },
  },
  buildActivityIncidentsData: {
    run: (client, baseUrl) =>
      buildActivityIncidentsData(client, {
        ...urls(baseUrl),
        processDefinitionKey: WORLD.key,
        activityId: WORLD.activityId,
      }),
    enrichment: {
      // The rows are named by their instances' business keys (#322 U13).
      "GET /process-instance?maxResults&processInstanceIds": (data: {
        incidents: Array<{ businessKey: unknown }>
      }) => data.incidents[0]?.businessKey,
    },
  },
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
}

/** The case's engine: the world plus its overrides, with at most one read broken. */
function engineReply(builder: Case, broken?: { read: string; reply: FakeReply }) {
  return (request: RecordedRequest): FakeReply =>
    broken && readOf(request) === broken.read
      ? broken.reply
      : (builder.world?.(request) ?? worldReply(request))
}

async function build(builder: Case, broken?: { read: string; reply: FakeReply }) {
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

describe.each(Object.entries(CASES))("%s", (_name, builder) => {
  const enrichment = builder.enrichment ?? {}

  it("builds from a healthy engine, reading every declared enrichment", async () => {
    const { outcome, reads } = await build(builder)
    expect(outcome.ok ? null : String(outcome.error)).toBeNull()
    // A stale declaration would exempt a read the builder no longer makes.
    expect([...reads]).toEqual(expect.arrayContaining(Object.keys(enrichment)))
    expect([...reads].filter((read) => !(read in enrichment)).length).toBeGreaterThan(0)
  })

  it("fails (never a confident 0 or []) when ANY primary read fails", async () => {
    const { reads } = await build(builder)
    const primary = [...reads].filter((read) => !(read in enrichment))
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

  it.runIf(builder.unknown)("fails on an unknown id instead of reporting zeros", async () => {
    const { outcome, reads } = await build(builder, builder.unknown)
    expect(outcome.ok).toBe(false)
    expect(reads).toContain(builder.unknown!.read)
  })
})

// The chips' counts are figures on screen: reads of their own (`readOf` tells their bodies apart),
// so the table above breaks each of them alone, whichever chip is on.
it.each(["", " (With incidents chip)", " (Suspended chip)"])(
  "buildProcessInstancesData%s counts All, With incidents and Suspended apart",
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

describe("the rejection table is complete", () => {
  it("names every data builder exported from src/data", async () => {
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
    // A variant case ("buildX (scan capped)") covers the same builder.
    const covered = new Set(Object.keys(CASES).map((name) => name.split(" ")[0]))
    expect(builders.sort()).toEqual([...covered].sort())
  })
})
