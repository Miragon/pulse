import type { Client } from "@miragon/pulse-camunda7-client"
import type { ActivityStat, BpmnViewerData } from "../view-models.js"
import {
  getActivityInstanceTree,
  getActivityStatistics,
  getIncidents,
  getJobs,
  getProcessDefinitions,
  getProcessInstance,
} from "@miragon/pulse-camunda7-client/sdk"
import {
  collectActiveActivityIds,
  collectIncidentActivityIds,
  countActivityInstances,
} from "../lib/activity-tree.js"
import { parseBpmnNames } from "@miragon/pulse-widget-shell/server"
import { definitionKeyInId, fetchDefinitionXml, findLatestDefinition } from "./definition-info.js"
import { optional, rowsOf } from "./engine-reads.js"

export interface BpmnViewerTarget {
  processInstanceId?: string
  /** Its badges count every running instance of the version. */
  processDefinitionKey?: string
  /** Latest when omitted. Needs `processDefinitionKey`. */
  version?: number
}

/**
 * Overlays are scoped to the TARGET (#335 N66): an instance's tokens and failed
 * jobs come from its own tree and jobs, never the definition's statistics.
 * Overlays are primary; the XML is enrichment.
 */
export async function buildBpmnViewerData(
  client: Client,
  engineId: string,
  target: BpmnViewerTarget,
): Promise<BpmnViewerData> {
  const processInstanceId = target.processInstanceId ?? null
  const { definitionId, businessKey } = await resolveTarget(client, target)

  if (!definitionId) {
    return emptyViewerData(processInstanceId, engineId)
  }

  const [bpmnXml, overlays] = await Promise.all([
    // Enrichment: the overlays still answer "where is this instance stuck?".
    optional(fetchDefinitionXml(client, definitionId)),
    processInstanceId
      ? instanceOverlays(client, processInstanceId)
      : definitionOverlays(client, definitionId),
  ])

  // Names before ids (#322 U13): the diagram names the view, no extra read.
  const processKey = target.processDefinitionKey ?? definitionKeyInId(definitionId)
  return {
    diagramDefinitionId: bpmnXml ? definitionId : null,
    processInstanceId,
    businessKey,
    processDefinitionId: definitionId,
    processDefinitionName: bpmnXml && processKey ? parseBpmnNames(bpmnXml, processKey).name : null,
    ...overlays,
    engineId,
  }
}

type Overlays = Pick<
  BpmnViewerData,
  "activeActivityIds" | "incidentActivityIds" | "activityStats" | "statsScope"
>

async function instanceOverlays(client: Client, processInstanceId: string): Promise<Overlays> {
  const [tree, incidents, failedJobs] = await Promise.all([
    getActivityInstanceTree({ client, path: { id: processInstanceId } }),
    getIncidents({ client, query: { processInstanceId } }).then((rows) => rowsOf(rows)),
    getJobs({ client, query: { processInstanceId, noRetriesLeft: true } }).then((rows) =>
      rowsOf<{ failedActivityId?: string | null }>(rows),
    ),
  ])
  const stats = new Map<string, ActivityStat>()
  const statOf = (id: string) => {
    const stat = stats.get(id) ?? { id, instances: 0, failedJobs: 0 }
    stats.set(id, stat)
    return stat
  }
  for (const [id, count] of countActivityInstances(tree)) statOf(id).instances = count
  for (const job of failedJobs) {
    if (job.failedActivityId) statOf(job.failedActivityId).failedJobs += 1
  }
  return {
    activeActivityIds: collectActiveActivityIds(tree),
    incidentActivityIds: collectIncidentActivityIds(incidents),
    activityStats: [...stats.values()],
    statsScope: "instance",
  }
}

async function definitionOverlays(client: Client, definitionId: string): Promise<Overlays> {
  const stats = rowsOf<{ id?: string | null; instances?: number; failedJobs?: number }>(
    await getActivityStatistics({
      client,
      path: { id: definitionId },
      query: { failedJobs: true },
    }),
  )
  return {
    activeActivityIds: [],
    incidentActivityIds: [],
    activityStats: stats.map((s) => ({
      id: s.id ?? "",
      instances: s.instances ?? 0,
      failedJobs: s.failedJobs ?? 0,
    })),
    statsScope: "definition",
  }
}

async function resolveTarget(
  client: Client,
  target: BpmnViewerTarget,
): Promise<{ definitionId: string | null; businessKey: string | null }> {
  if (target.processInstanceId) {
    const instance = (await getProcessInstance({
      client,
      path: { id: target.processInstanceId },
    })) as { definitionId?: string; businessKey?: string | null } | null
    return {
      definitionId: instance?.definitionId ?? null,
      businessKey: instance?.businessKey ?? null,
    }
  }
  return { definitionId: await resolveDefinitionId(client, target), businessKey: null }
}

async function resolveDefinitionId(
  client: Client,
  target: BpmnViewerTarget,
): Promise<string | null> {
  if (target.processDefinitionKey === undefined) return null
  if (target.version === undefined) {
    return (await findLatestDefinition(client, target.processDefinitionKey))?.id || null
  }
  const matches = rowsOf<{ id?: string }>(
    await getProcessDefinitions({
      client,
      query: { key: target.processDefinitionKey, version: target.version, maxResults: 1 },
    }),
  )
  return matches[0]?.id ?? null
}

function emptyViewerData(processInstanceId: string | null, engineId: string): BpmnViewerData {
  return {
    diagramDefinitionId: null,
    processInstanceId,
    businessKey: null,
    processDefinitionId: null,
    processDefinitionName: null,
    activeActivityIds: [],
    incidentActivityIds: [],
    activityStats: [],
    statsScope: processInstanceId ? "instance" : "definition",
    engineId,
  }
}
