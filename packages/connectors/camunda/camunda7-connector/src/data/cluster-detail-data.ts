import {
  earliestEngineDate,
  engineLike,
  latestEngineDate,
  toEngineDate,
  type Client,
} from "@miragon/pulse-camunda7-client"
import {
  getIncidents,
  getIncidentsCount,
  getProcessInstances,
} from "@miragon/pulse-camunda7-client/sdk"
import type { ClusterDetailData, ClusterIncidentRow } from "../view-models.js"
import type { ClusterDetailFilters, PagingArgs } from "../feed-contracts.js"
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
  elementNameIn,
  fetchNamesByDefinition,
  processNameIn,
  resolveDefinitionKeys,
} from "./definition-info.js"
import { countOf, DAY_MS, optional, rowsOf } from "./engine-reads.js"
import { fetchBusinessKeys, isOnOrAfter } from "./incident-scan.js"

const CLUSTER_DETAIL_ROWS = 50

/**
 * `/incident` has no business-key filter: matching instance ids come from
 * `/process-instance?businessKeyLike=`. Only the list narrows; the KPIs keep
 * describing the WHOLE cluster.
 */
export type ClusterDetailArgs = ClusterDetailFilters & PagingArgs

/**
 * The process keys scope guarded remediation, so they resolve exactly (primary).
 * Once the scan hits {@link CLUSTER_SCAN_LIMIT} (a mass failure, exactly when a
 * cluster gets drilled into) its length is no total: counts come from
 * `/incident/count` without a message filter, else are null.
 */
export async function buildClusterDetailData(
  client: Client,
  engineId: string,
  args: ClusterDetailArgs,
): Promise<ClusterDetailData> {
  // Primary fetch: failures propagate as tool errors (no silent []).
  const [incidentsRaw, searchHitsRaw] = await Promise.all([
    getIncidents({
      client,
      query: {
        activityId: args.activityId,
        incidentType: args.incidentType,
        maxResults: CLUSTER_SCAN_LIMIT,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
      },
    }).then((rows) => rowsOf<IncidentLike>(rows)),
    args.businessKeyLike
      ? getProcessInstances({
          client,
          query: {
            businessKeyLike: engineLike(args.businessKeyLike),
            maxResults: CLUSTER_SCAN_LIMIT,
          },
        }).then((rows) => rowsOf<{ id?: string | null }>(rows))
      : Promise.resolve(null),
  ])

  const coverage = scanCoverage(incidentsRaw)
  const matching =
    args.messageSignature === undefined
      ? incidentsRaw
      : incidentsRaw.filter(
          (i) => messageSignature(i.incidentMessage ?? null) === args.messageSignature,
        )

  const listed = filterToSearchHits(matching, searchHitsRaw)

  const nowMs = Date.now()

  // Paging slices the listed set in memory: the signature/business-key filters
  // are resolved here, so an engine offset would change semantics.
  // `scannedIncidentCount` discloses that the list is bounded by the scan.
  const first = Math.max(0, args.firstResult ?? 0)
  const pageSize = args.maxResults ?? CLUSTER_DETAIL_ROWS
  const page = listed.slice(first, first + pageSize)

  const [counts, businessKeyById, keyOf, names] = await Promise.all([
    clusterCounts(client, args, { coverage, matching, nowMs }),
    // Enrichment: a failed lookup names the rows by their short ids.
    optional(
      fetchBusinessKeys(
        client,
        page.map((i) => i.processInstanceId),
      ),
    ).then((keys) => keys ?? new Map<string, string | null>()),
    resolveDefinitionKeys(
      client,
      matching.map((i) => i.processDefinitionId),
    ),
    // Names before ids (#322 U13); enrichment.
    fetchNamesByDefinition(client, [
      matching[0]?.processDefinitionId,
      ...page.map((i) => i.processDefinitionId),
    ]),
  ])
  const defKey = (i: IncidentLike) =>
    (i.processDefinitionId ? keyOf(i.processDefinitionId) : null) ?? UNKNOWN
  const kpis = aggregateClusterKpis(matching, defKey)

  const incidents: ClusterIncidentRow[] = page.map((i) => ({
    incidentId: i.id ?? "",
    processInstanceId: i.processInstanceId ?? "",
    businessKey: i.processInstanceId ? (businessKeyById.get(i.processInstanceId) ?? null) : null,
    processDefinitionKey: defKey(i),
    processDefinitionName: processNameIn(names, i.processDefinitionId, defKey(i)),
    incidentTimestamp: i.incidentTimestamp ?? "",
  }))

  return {
    activityId: args.activityId,
    activityName: elementNameIn(names, matching[0]?.processDefinitionId, args.activityId),
    incidentType: args.incidentType,
    messageSignature: args.messageSignature ?? null,
    ...counts,
    scannedIncidentCount: matching.length,
    // Its oldest row is the cluster's first only when the scan holds the whole cluster.
    firstSeen: coverage.complete ? earliestEngineDate(kpis.timestamps) : null,
    latestIncident: latestEngineDate(kpis.timestamps),
    processDefinitionKeys: [...kpis.defCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k),
    representativeMessage: truncateMessage(matching[0]?.incidentMessage ?? null, 600),
    incidents,
    totalMatching: listed.length,
    fetchedAt: new Date(nowMs).toISOString(),
    engineId,
  }
}

/** Search narrows the LIST (and its total), never the cluster KPIs. */
function filterToSearchHits(
  matching: IncidentLike[],
  searchHits: Array<{ id?: string | null }> | null,
): IncidentLike[] {
  if (searchHits === null) return matching
  const hitIds = new Set(searchHits.map((i) => i.id).filter((id): id is string => !!id))
  return matching.filter((i) => i.processInstanceId && hitIds.has(i.processInstanceId))
}

function aggregateClusterKpis(
  matching: IncidentLike[],
  keyOf: (incident: IncidentLike) => string,
): {
  timestamps: Array<string | null | undefined>
  defCounts: Map<string, number>
} {
  const defCounts = new Map<string, number>()
  for (const inc of matching) {
    const defKey = keyOf(inc)
    defCounts.set(defKey, (defCounts.get(defKey) ?? 0) + 1)
  }
  return { timestamps: matching.map((inc) => inc.incidentTimestamp), defCounts }
}

type ClusterWindowCounts = Pick<
  ClusterDetailData,
  "incidentCount" | "lastHourCount" | "last24hCount"
>

/**
 * From the scan where it can vouch (whole cluster, or reaches past the window),
 * else `/incident/count`, which only answers WITHOUT a message filter; with
 * one, an unvouched count is null.
 */
function clusterCounts(
  client: Client,
  args: ClusterDetailArgs,
  scan: { coverage: ScanCoverage; matching: IncidentLike[]; nowMs: number },
): Promise<ClusterWindowCounts> {
  const { coverage, matching, nowMs } = scan
  const exact = (sinceMs?: number) =>
    args.messageSignature === undefined
      ? getIncidentsCount({
          client,
          query: {
            activityId: args.activityId,
            incidentType: args.incidentType,
            incidentTimestampAfter:
              sinceMs === undefined ? undefined : toEngineDate(new Date(sinceMs)),
          },
        }).then(countOf)
      : Promise.resolve(null)
  const since = (sinceMs: number) =>
    coverage.covers(sinceMs)
      ? Promise.resolve(matching.filter((i) => isOnOrAfter(i.incidentTimestamp, sinceMs)).length)
      : exact(sinceMs)
  return Promise.all([
    coverage.complete ? Promise.resolve(matching.length) : exact(),
    since(nowMs - HOUR_MS),
    since(nowMs - DAY_MS),
  ]).then(([incidentCount, lastHourCount, last24hCount]) => ({
    incidentCount,
    lastHourCount,
    last24hCount,
  }))
}
