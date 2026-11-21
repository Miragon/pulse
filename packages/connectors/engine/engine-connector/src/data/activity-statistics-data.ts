import type { Client } from "@miragon/pulse-c7-client"
import type { ActivityStatisticsArgs } from "../feed-contracts.js"
import type {
  ActivityStatisticsActivity,
  ActivityStatisticsData,
  ActivityThroughputData,
} from "../view-models.js"
import { placeOnDiagram, readDiagramXml } from "./activity-diagram.js"
import { readActivityThroughput } from "./activity-throughput.js"
import { fetchDefinitionVersions, fetchLatestDefinition } from "./definition-info.js"
import { readElementCounts, type ElementCounts } from "./element-counts.js"

type Counts = Pick<
  ActivityStatisticsActivity,
  "running" | "failedJobs" | "incidents" | "incidentsInCalledInstances"
>

/** Each element's counts; nothing there is no row. */
function countsPerElement(elements: Map<string, ElementCounts>): Map<string, Counts> {
  return new Map(
    [...elements]
      .map(([id, element]): [string, Counts] => [
        id,
        {
          running: element.active,
          incidents: element.incidents,
          incidentsInCalledInstances: element.incidentsInCalledInstances,
          failedJobs: element.failedJobs,
        },
      ])
      .filter(
        ([, c]) =>
          c.running > 0 || c.failedJobs > 0 || c.incidents > 0 || c.incidentsInCalledInstances > 0,
      ),
  )
}

/**
 * The process flow's "Running": what runs at each element of a key now. Old versions keep running
 * after a redeploy, so every version is read (#335 N60) and summed per element onto the latest
 * version's diagram; an element only an older version has says so (`inDiagram: false`). Each
 * version's counts are the shared process screen's (`readElementCounts`, one statistics read with
 * the jobs without retries and the version's incidents whole, four versions at once, on the floor of
 * 30 s per caller): the tokens without those a root incident holds, the root incidents raised there
 * and, apart, the incidents of the instances a call activity called, and its jobs without retries.
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
  const versionIds = versions.map((version) => version.id)
  const [elements, bpmnXml] = await Promise.all([
    readElementCounts(client, versionIds),
    readDiagramXml(client, diagram),
  ])
  const place = placeOnDiagram(bpmnXml)
  const activities = [...countsPerElement(elements)]
    .map(([activityId, counts]) => ({ activityId, ...place(activityId), ...counts }))
    .sort(
      (a, b) =>
        b.running - a.running ||
        b.incidents - a.incidents ||
        b.incidentsInCalledInstances - a.incidentsInCalledInstances ||
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
