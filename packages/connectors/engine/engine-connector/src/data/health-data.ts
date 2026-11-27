import type { Client } from "@miragon/pulse-c7-client"
import {
  causeKeyOf,
  criticalIncidentsRule,
  DEFAULT_VERDICT_THRESHOLDS,
  elementOfActivity,
  engineDateMillis,
  engineVerdict,
  isRootIncident,
  latestEngineDate,
  rootIncidentCounts,
  toEngineDate,
  type VerdictThresholds,
} from "@miragon/pulse-c7-core"
import { getHistoricProcessInstancesCount } from "@miragon/pulse-c7-client/sdk"
import type { EngineHealthCluster, EngineHealthData } from "../view-models.js"
import {
  HOUR_MS,
  scanCoverage,
  scanOpenIncidents,
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
import { DAY_MS } from "./engine-reads.js"

const MAX_CLUSTERS = 6

interface ClusterAcc {
  /** c7-core's cause key (`causeKeyOf`), the cluster's route id. */
  key: string
  activityId: string
  incidentType: string
  signature: string
  count: number
  keys: Map<string, number>
  sampleMessage: string | null
  sampleIncidentId: string
  /** Whose diagram names the activity. */
  sampleDefinitionId: string | null
  latest: string | null
}

/**
 * How the overview's `status` comes about: c7-core's verdict over the open root incidents (the
 * processes', which the view counts, and those outside any process), a call activity's copy of a
 * called instance's never.
 */
export function healthVerdictRule(t: VerdictThresholds): string {
  return `From the engine's open root incidents (a copy at a call activity never counts), read live: critical at ${criticalIncidentsRule(t)}, warning with any, else ok.`
}

interface IncidentScanAgg {
  byCluster: Map<string, ClusterAcc>
  activitySet: Set<string>
}

interface IncidentFacts {
  activityId: string
  incidentType: string
  signature: string
  /** c7-core's cause key: same activity and type but another exception is another cause. */
  clusterKey: string
  defKey: string
  ts: string
}

function deriveIncidentFacts(
  inc: IncidentLike,
  keyOf: (definitionId: string) => string | null,
): IncidentFacts {
  const { activityId, incidentType, signature, key } = causeKeyOf(inc)
  const defKey = (inc.processDefinitionId ? keyOf(inc.processDefinitionId) : null) ?? UNKNOWN
  return {
    activityId,
    incidentType,
    signature,
    clusterKey: key,
    defKey,
    ts: inc.incidentTimestamp ?? "",
  }
}

/**
 * The causes and the affected activities come from the root incidents alone (`isRootIncident`): a
 * call activity's copy of a called instance's failure is that failure, not a cause or an activity
 * of its own without a message. A multi-instance body's failure (`<id>#multiInstanceBody`, its own
 * job) is a cause of its own, by the id its cluster reads, at the activity it repeats
 * (`elementOfActivity`), which counts once with its items.
 */
function clusterIncidents(
  roots: IncidentLike[],
  keyOf: (definitionId: string) => string | null,
): IncidentScanAgg {
  const byCluster = new Map<string, ClusterAcc>()
  const activitySet = new Set<string>()

  for (const inc of roots) {
    const facts = deriveIncidentFacts(inc, keyOf)
    activitySet.add(elementOfActivity(facts.activityId))

    const acc =
      byCluster.get(facts.clusterKey) ??
      ({
        key: facts.clusterKey,
        activityId: facts.activityId,
        incidentType: facts.incidentType,
        signature: facts.signature,
        count: 0,
        keys: new Map<string, number>(),
        sampleMessage: truncateMessage(inc.incidentMessage ?? null),
        sampleIncidentId: inc.id ?? "",
        sampleDefinitionId: inc.processDefinitionId ?? null,
        latest: null,
      } satisfies ClusterAcc)

    acc.count += 1
    acc.keys.set(facts.defKey, (acc.keys.get(facts.defKey) ?? 0) + 1)
    acc.latest = latestEngineDate([acc.latest, facts.ts])
    byCluster.set(facts.clusterKey, acc)
  }

  return { byCluster, activitySet }
}

/**
 * Counts are exact only as far as the scan reaches: the total when it read everything, else null.
 * Names are enrichment; the id stands in when unknown.
 */
function toClusterList(
  ranked: ClusterAcc[],
  coverage: ScanCoverage,
  display: { names: NamesByDefinition; statsByKey: Map<string, KeyStats> },
): EngineHealthCluster[] {
  return ranked.map((c) => {
    const keys = [...c.keys.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const primaryKey = keys.find((k) => k !== UNKNOWN)
    return {
      id: c.key,
      activityId: c.activityId,
      activityName: elementNameIn(display.names, c.sampleDefinitionId, c.activityId),
      incidentType: c.incidentType,
      messageSignature: c.signature,
      incidentCount: coverage.complete ? c.count : null,
      scannedIncidentCount: c.count,
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

/**
 * The root incidents raised since `sinceMs`, where the scan holds every incident since then (it
 * reaches past it, or holds every open incident), else null: a window Camunda 7 cannot count
 * root incidents in by itself (no `/count` tells a root from a copy), so a count the scan cannot
 * vouch for is unknown, never a guess.
 */
function rootsSince(roots: IncidentLike[], coverage: ScanCoverage, sinceMs: number): number | null {
  if (!coverage.covers(sinceMs)) return null
  return roots.filter((inc) => {
    const ms = engineDateMillis(inc.incidentTimestamp)
    return ms !== null && ms >= sinceMs
  }).length
}

/**
 * Deterministic, no LLM: the widget hands each cluster to the host agent on demand. Its incident
 * counts are open ROOT incidents (owner decision D2, amended on 2026-11-19): the definition
 * statistics' (`rootIncidents=true`) summed over every process, and the scan's root incidents for the
 * clusters, the affected activities and the last hour. The verdict counts root incidents too (owner
 * decision of 2026-11-20): c7-core's `rootIncidentCounts` over the same statistics and scan.
 */
export async function buildEngineHealthData(
  client: Client,
  engineId: string,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): Promise<EngineHealthData> {
  // History filters take the engine's date format (REST contract).
  const startMs = Date.now()
  const dayAgoParam = toEngineDate(new Date(startMs - DAY_MS))

  // Deliberately NO .catch(() => []) on the verdict inputs: a down engine must
  // be a tool error, never a confident "ok" verdict. The throughput counts are
  // optional, since history level "none" is a healthy engine. Totals come from
  // statistics; the capped scan feeds the clusters and the verdict's lower bounds.
  const [incidents, statsByKey, startedRes, completedRes] = await Promise.all([
    scanOpenIncidents(client),
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
  const totalIncidents = keyStats.reduce((sum, k) => sum + k.incidentCount, 0)
  const affectedDefinitions = keyStats.filter((k) => k.incidentCount > 0).length

  const coverage = scanCoverage(incidents)
  const roots = incidents.filter(isRootIncident)
  // A bare generated definition id (long keys) carries no parseable key.
  const { byCluster, activitySet } = clusterIncidents(roots, definitionKeyResolver(statsByKey))
  const ranked = topClusters(byCluster)
  const names = await fetchNamesByDefinition(
    client,
    ranked.map((c) => c.sampleDefinitionId),
  )
  const clusters = toClusterList(ranked, coverage, { names, statsByKey })
  // The affected activities are exact only when the scan read every incident.
  const affectedActivities = coverage.complete ? activitySet.size : null

  // c7-core's verdict over the open root incidents, as engine_status judges: the processes' of
  // the statistics and, of the scan, those outside any process and the largest cause over root
  // incidents alone, lower bounds that never raise a false "critical". The verdict travels as
  // data; each reader words it.
  const status = engineVerdict(rootIncidentCounts(totalIncidents, incidents), thresholds)

  return {
    status,
    statusRule: healthVerdictRule(thresholds),
    summary: {
      totalIncidents,
      lastHourIncidents: rootsSince(roots, coverage, nowMs - HOUR_MS),
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
