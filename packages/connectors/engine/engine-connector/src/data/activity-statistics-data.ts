import type { Client } from "@miragon/pulse-engine-client"
import { getActivityStatistics } from "@miragon/pulse-engine-client/sdk"
import { mapLimit } from "@miragon/pulse-engine-core"
import type { ActivityStatisticsArgs } from "../feed-contracts.js"
import type {
  ActivityStatisticsActivity,
  ActivityStatisticsData,
  ActivityThroughputData,
} from "../view-models.js"
import { MULTI_INSTANCE_BODY, placeOnDiagram, readDiagramXml } from "./activity-diagram.js"
import { readActivityThroughput } from "./activity-throughput.js"
import { fetchDefinitionVersions, fetchLatestDefinition } from "./definition-info.js"
import { rowsOf } from "./engine-reads.js"

/** Version reads in flight at once: a key with many versions never fans out in one burst. */
const VERSION_READS_AT_ONCE = 4

interface ActivityStatsRow {
  id?: string | null
  instances?: number | null
  failedJobs?: number | null
  incidents?: Array<{ incidentCount?: number | null }> | null
}

type Counts = Pick<ActivityStatisticsActivity, "running" | "failedJobs" | "incidents">

function readVersion(client: Client, definitionId: string): Promise<ActivityStatsRow[]> {
  return getActivityStatistics({
    client,
    path: { id: definitionId },
    query: { failedJobs: true, incidents: true },
  }).then((rows) => rowsOf<ActivityStatsRow>(rows))
}

/** Sums the versions' rows per element (a multi-instance body on its element); nothing there is no row. */
function sumPerElement(rows: ActivityStatsRow[]): Map<string, Counts> {
  const byElement = new Map<string, Counts>()
  for (const row of rows) {
    if (!row.id) continue
    const id = row.id.replace(MULTI_INSTANCE_BODY, "")
    const counts = byElement.get(id) ?? { running: 0, failedJobs: 0, incidents: 0 }
    counts.running += row.instances ?? 0
    counts.failedJobs += row.failedJobs ?? 0
    counts.incidents += (row.incidents ?? []).reduce((sum, i) => sum + (i.incidentCount ?? 0), 0)
    byElement.set(id, counts)
  }
  return new Map(
    [...byElement].filter(([, c]) => c.running > 0 || c.failedJobs > 0 || c.incidents > 0),
  )
}

/**
 * The process flow's "Running": what runs at each element of a key now. Old versions keep running
 * after a redeploy, so every version is read (#335 N60) and summed per element onto the latest
 * version's diagram; an element only an older version has says so (`inDiagram: false`).
 */
async function readRunning(
  client: Client,
  key: string,
): Promise<Omit<ActivityStatisticsData, "engineId">> {
  const [diagram, versions] = await Promise.all([
    // Primary: an unknown key is a not-found error, never a view of zeros.
    fetchLatestDefinition(client, key),
    fetchDefinitionVersions(client, key),
  ])
  const [perVersion, bpmnXml] = await Promise.all([
    mapLimit(versions, VERSION_READS_AT_ONCE, (version) => readVersion(client, version.id)),
    readDiagramXml(client, diagram),
  ])
  const place = placeOnDiagram(bpmnXml)
  const activities = [...sumPerElement(perVersion.flat())]
    .map(([activityId, counts]) => ({ activityId, ...place(activityId), ...counts }))
    .sort(
      (a, b) =>
        b.running - a.running ||
        b.incidents - a.incidents ||
        a.activityId.localeCompare(b.activityId, "en"),
    )
  return {
    processDefinitionKey: key,
    source: "runtime",
    diagramDefinitionId: diagram.id || null,
    diagramVersion: diagram.version,
    versionCount: versions.length,
    activities,
  }
}

/** The feed's payload: "Running" (`runtime`) or "Throughput" (`history`). */
export type ActivityStatisticsFeedData = ActivityStatisticsData | ActivityThroughputData

/** Each variant without the engine id the feed adds (a plain `Omit` would merge the variants). */
type WithoutEngineId<T> = T extends unknown ? Omit<T, "engineId"> : never

/**
 * The process flow's element counts, read from the engine REST API: what runs at each element now
 * (`runtime`), or what the instances started in the last 30 days passed there (`history`, kept per
 * engine client, caller and key for the hour).
 */
export function buildActivityStatisticsData(
  client: Client,
  { processDefinitionKey, source }: ActivityStatisticsArgs,
  nowMs: number = Date.now(),
): Promise<WithoutEngineId<ActivityStatisticsFeedData>> {
  return source === "history"
    ? readActivityThroughput(client, processDefinitionKey, nowMs)
    : readRunning(client, processDefinitionKey)
}
