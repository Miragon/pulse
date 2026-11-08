import type { Client } from "@miragon/pulse-engine-client"
import { getActivityStatistics } from "@miragon/pulse-engine-client/sdk"
import { mapLimit } from "@miragon/pulse-engine-core"
import { readBpmnNames } from "@miragon/pulse-widget-shell/server"
import type { ActivityStatisticsArgs } from "../feed-contracts.js"
import { bpmnActivityIds } from "../lib/bpmn/bpmn-parse.js"
import type { ActivityStatisticsActivity, ActivityStatisticsData } from "../view-models.js"
import {
  fetchDefinitionVersions,
  fetchDefinitionXml,
  fetchLatestDefinition,
} from "./definition-info.js"
import { optional, rowsOf } from "./engine-reads.js"

/** Version reads in flight at once: a key with many versions never fans out in one burst. */
const VERSION_READS_AT_ONCE = 4

/** A multi-instance activity's body is reported as its own id; it stands on its element. */
const MULTI_INSTANCE_BODY = /#multiInstanceBody$/

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

/** Sums the versions' rows per element; an element with nothing there is no row. */
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
export async function buildActivityStatisticsData(
  client: Client,
  { processDefinitionKey: key }: Pick<ActivityStatisticsArgs, "processDefinitionKey">,
): Promise<Omit<ActivityStatisticsData, "engineId">> {
  const [diagram, versions] = await Promise.all([
    // Primary: an unknown key is a not-found error, never a view of zeros.
    fetchLatestDefinition(client, key),
    fetchDefinitionVersions(client, key),
  ])
  const [perVersion, bpmnXml] = await Promise.all([
    mapLimit(versions, VERSION_READS_AT_ONCE, (version) => readVersion(client, version.id)),
    diagram.id ? optional(fetchDefinitionXml(client, diagram.id)) : Promise.resolve(null),
  ])

  const diagramIds = bpmnXml ? new Set(bpmnActivityIds(bpmnXml)) : null
  const names = readBpmnNames(bpmnXml ?? "").elements
  const activities = [...sumPerElement(perVersion.flat())]
    .map(([activityId, counts]) => ({
      activityId,
      activityName: Object.hasOwn(names, activityId) ? names[activityId] : null,
      inDiagram: diagramIds ? diagramIds.has(activityId) : null,
      ...counts,
    }))
    .sort(
      (a, b) =>
        b.running - a.running ||
        b.incidents - a.incidents ||
        a.activityId.localeCompare(b.activityId),
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
