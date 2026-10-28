import {
  engineDateMillis,
  latestEngineDate,
  toEngineDate,
  type Client,
} from "@miragon/pulse-camunda7-client"
import {
  getHistoricProcessInstancesCount,
  getIncidents,
  getIncidentsCount,
} from "@miragon/pulse-camunda7-client/sdk"
import type { EngineHealthCluster, EngineHealthData, EngineHealthStatus } from "../view-models.js"
import {
  CLUSTER_SCAN_LIMIT,
  HOUR_MS,
  messageSignature,
  scanCoverage,
  truncateMessage,
  UNKNOWN,
  type IncidentLike,
  type ScanCoverage,
} from "./cluster-scan.js"
import {
  definitionKeyResolver,
  elementNameIn,
  fetchNamesByDefinition,
  fetchStatsByKey,
  processNameIn,
  type KeyStats,
  type NamesByDefinition,
} from "./definition-info.js"
import { countOf, DAY_MS, rowsOf } from "./engine-reads.js"

/** Deployment-tunable (`CAMUNDA_HEALTH_*`) so the verdict is explainable per installation. */
export interface EngineHealthThresholds {
  criticalIncidents: number
  criticalClusterSize: number
}

export const DEFAULT_HEALTH_THRESHOLDS: EngineHealthThresholds = {
  criticalIncidents: 50,
  criticalClusterSize: 25,
}

const MAX_CLUSTERS = 6

interface ClusterAcc {
  activityId: string
  incidentType: string
  signature: string
  count: number
  last24h: number
  keys: Map<string, number>
  sampleMessage: string | null
  sampleIncidentId: string
  /** Whose diagram names the activity. */
  sampleDefinitionId: string | null
  latest: string | null
}

/**
 * Carried in every payload so no reader mistakes this incident-count verdict for
 * analytics_engine_health's alert-based one; the two may disagree.
 */
export function healthVerdictRule(t: EngineHealthThresholds): string {
  return (
    `From the engine's open incidents, read live: critical at >=${t.criticalIncidents} open ` +
    `or >=${t.criticalClusterSize} in one cluster, degraded with any, else ok.`
  )
}

function statusOf(
  totalIncidents: number,
  topClusterSize: number,
  t: EngineHealthThresholds,
): EngineHealthStatus {
  if (totalIncidents >= t.criticalIncidents || topClusterSize >= t.criticalClusterSize) {
    return "critical"
  }
  return totalIncidents > 0 ? "degraded" : "ok"
}

interface IncidentScanAgg {
  byCluster: Map<string, ClusterAcc>
  activitySet: Set<string>
}

interface IncidentFacts {
  activityId: string
  incidentType: string
  signature: string
  /** Same activity and type but a different exception is a different root cause. */
  clusterKey: string
  defKey: string
  ts: string
  isRecent: boolean
}

/**
 * Compare instants, never strings: engine timestamps carry its local UTC offset
 * (`…+0200`), which orders neither against a Zulu cutoff nor across a DST change.
 */
function deriveIncidentFacts(
  inc: IncidentLike,
  cutoffMs: number,
  keyOf: (definitionId: string) => string | null,
): IncidentFacts {
  const activityId = inc.activityId ?? UNKNOWN
  const incidentType = inc.incidentType ?? "unknown"
  const signature = messageSignature(inc.incidentMessage ?? null)
  const defKey = (inc.processDefinitionId ? keyOf(inc.processDefinitionId) : null) ?? UNKNOWN
  const ts = inc.incidentTimestamp ?? ""
  const tsMs = engineDateMillis(ts)
  return {
    activityId,
    incidentType,
    signature,
    clusterKey: `${activityId}::${incidentType}::${signature}`,
    defKey,
    ts,
    isRecent: tsMs !== null && tsMs >= cutoffMs,
  }
}

function clusterIncidents(
  incidents: IncidentLike[],
  cutoffMs: number,
  keyOf: (definitionId: string) => string | null,
): IncidentScanAgg {
  const byCluster = new Map<string, ClusterAcc>()
  const activitySet = new Set<string>()

  for (const inc of incidents) {
    const facts = deriveIncidentFacts(inc, cutoffMs, keyOf)
    activitySet.add(facts.activityId)

    const acc =
      byCluster.get(facts.clusterKey) ??
      ({
        activityId: facts.activityId,
        incidentType: facts.incidentType,
        signature: facts.signature,
        count: 0,
        last24h: 0,
        keys: new Map<string, number>(),
        sampleMessage: truncateMessage(inc.incidentMessage ?? null),
        sampleIncidentId: inc.id ?? "",
        sampleDefinitionId: inc.processDefinitionId ?? null,
        latest: null,
      } satisfies ClusterAcc)

    acc.count += 1
    if (facts.isRecent) acc.last24h += 1
    acc.keys.set(facts.defKey, (acc.keys.get(facts.defKey) ?? 0) + 1)
    acc.latest = latestEngineDate([acc.latest, facts.ts])
    byCluster.set(facts.clusterKey, acc)
  }

  return { byCluster, activitySet }
}

/**
 * Counts are exact only as far as the scan reaches: the total when it read
 * everything, the 24h count when it reaches past the cutoff, else null.
 * Names are enrichment; the id stands in when unknown.
 */
function toClusterList(
  ranked: ClusterAcc[],
  coverage: ScanCoverage,
  cutoffMs: number,
  display: { names: NamesByDefinition; statsByKey: Map<string, KeyStats> },
): EngineHealthCluster[] {
  return ranked.map((c) => {
    const keys = [...c.keys.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const primaryKey = keys.find((k) => k !== UNKNOWN)
    return {
      id: `${c.activityId}::${c.incidentType}::${c.signature}`,
      activityId: c.activityId,
      activityName: elementNameIn(display.names, c.sampleDefinitionId, c.activityId),
      incidentType: c.incidentType,
      messageSignature: c.signature,
      incidentCount: coverage.complete ? c.count : null,
      scannedIncidentCount: c.count,
      last24hCount: coverage.covers(cutoffMs) ? c.last24h : null,
      processDefinitionKeys: keys,
      processDefinitionName:
        (primaryKey ? display.statsByKey.get(primaryKey)?.latest.name : null) ??
        processNameIn(display.names, c.sampleDefinitionId, primaryKey),
      representativeMessage: c.sampleMessage,
      representativeIncidentId: c.sampleIncidentId,
      latestIncident: c.latest,
    }
  })
}

function topClusters(byCluster: Map<string, ClusterAcc>): ClusterAcc[] {
  return [...byCluster.values()].sort((a, b) => b.count - a.count).slice(0, MAX_CLUSTERS)
}

/** Deterministic, no LLM: the widget hands each cluster to the host agent on demand. */
export async function buildEngineHealthData(
  client: Client,
  engineId: string,
  thresholds: EngineHealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): Promise<EngineHealthData> {
  // History filters take the engine's date format (engine contract).
  const startMs = Date.now()
  const dayAgoParam = toEngineDate(new Date(startMs - DAY_MS))
  const hourAgoParam = toEngineDate(new Date(startMs - HOUR_MS))

  // Deliberately NO .catch(() => []) on the verdict inputs: a down engine must
  // be a tool error, never a confident "ok" verdict. The throughput counts are
  // optional, since history level "none" is a healthy engine. Totals come from
  // `/count` or statistics; the capped scan only feeds the clusters.
  const count = (query: { incidentTimestampAfter?: string }) =>
    getIncidentsCount({ client, query }).then(countOf)
  const [
    incidents,
    totalIncidents,
    lastHourIncidents,
    last24hIncidents,
    statsByKey,
    startedRes,
    completedRes,
  ] = await Promise.all([
    getIncidents({
      client,
      query: { maxResults: CLUSTER_SCAN_LIMIT, sortBy: "incidentTimestamp", sortOrder: "desc" },
    }).then((rows) => rowsOf<IncidentLike>(rows)),
    count({}),
    count({ incidentTimestampAfter: hourAgoParam }),
    count({ incidentTimestampAfter: dayAgoParam }),
    fetchStatsByKey(client, {}),
    getHistoricProcessInstancesCount({ client, query: { startedAfter: dayAgoParam } }).catch(
      () => null,
    ),
    getHistoricProcessInstancesCount({ client, query: { finishedAfter: dayAgoParam } }).catch(
      () => null,
    ),
  ])

  const nowMs = Date.now()

  const keyStats = [...statsByKey.values()]
  const runningInstances = keyStats.reduce((sum, k) => sum + k.instances, 0)
  const affectedDefinitions = keyStats.filter((k) => k.incidentCount > 0).length

  const cutoffMs = nowMs - DAY_MS
  const coverage = scanCoverage(incidents)
  // A bare generated definition id (long keys) carries no parseable key.
  const { byCluster, activitySet } = clusterIncidents(
    incidents,
    cutoffMs,
    definitionKeyResolver(statsByKey),
  )
  const ranked = topClusters(byCluster)
  const names = await fetchNamesByDefinition(
    client,
    ranked.map((c) => c.sampleDefinitionId),
  )
  const clusters = toClusterList(ranked, coverage, cutoffMs, { names, statsByKey })
  // The affected activities are exact only when the scan read every incident.
  const affectedActivities = coverage.complete ? activitySet.size : null

  // The top cluster's SCANNED share is a lower bound, so it never raises a false
  // "critical"; a capped scan means at least CLUSTER_SCAN_LIMIT incidents, which
  // the total rule judges. The verdict travels as data; each reader words it.
  const status = statusOf(totalIncidents, clusters[0]?.scannedIncidentCount ?? 0, thresholds)

  return {
    status,
    statusRule: healthVerdictRule(thresholds),
    summary: {
      totalIncidents,
      lastHourIncidents,
      last24hIncidents,
      affectedActivities,
      affectedDefinitions,
      runningInstances,
      totalDefinitions: statsByKey.size,
      started24h: startedRes?.count ?? null,
      completed24h: completedRes?.count ?? null,
    },
    clusters,
    fetchedAt: new Date(nowMs).toISOString(),
    engineId,
  }
}
