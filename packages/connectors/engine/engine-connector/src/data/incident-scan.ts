import type { Client } from "@miragon/pulse-c7-client"
import {
  earliestEngineDate,
  engineDateMillis,
  incidentRecovery,
  latestEngineDate,
  mapLimit,
  PARALLEL,
  rootIdOfCopy,
} from "@miragon/pulse-c7-core"
import { getIncident, getIncidents, getProcessInstances } from "@miragon/pulse-c7-client/sdk"
import type { IncidentInstance, IncidentRootCause } from "../view-models.js"
import type { EngineProvider } from "../engine-provider.js"
import { buildInstanceCockpitUrl } from "../lib/engine/cockpit-url.js"
import {
  definitionVersionFromId,
  elementNameIn,
  fetchNamesByDefinition,
} from "./definition-info.js"
import { INCIDENT_SCAN_LIMIT, optional, rowsOf } from "./engine-reads.js"

/**
 * The newest {@link INCIDENT_SCAN_LIMIT} open incidents: enrichment only, and a
 * fact the scan cannot vouch for is `null`, never a count over a capped page.
 */

/** Carries the definition id, not the key: resolve it via `resolveDefinitionKeys`. */
export interface IncidentRow {
  id: string
  processDefinitionId: string
  processInstanceId: string
  incidentType: string
  activityId: string
  incidentMessage: string | null
  incidentTimestamp: string
  configuration: string | null
  /** The incident a call activity's copy copies; its own id on a root (`isRootIncident`). */
  rootCauseIncidentId?: string | null
}

export interface IncidentScan {
  rows: IncidentRow[]
  /** The engine returned fewer than the limit. */
  complete: boolean
}

export async function scanIncidents(
  client: Client,
  filter: { processDefinitionKeyIn?: string; incidentType?: string },
): Promise<IncidentScan> {
  const rows = rowsOf<IncidentRow>(
    await getIncidents({
      client,
      query: {
        ...filter,
        maxResults: INCIDENT_SCAN_LIMIT,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
      },
    }),
  )
  return { rows, complete: rows.length < INCIDENT_SCAN_LIMIT }
}

/** Rows per request of a whole read (`readAllIncidents`), the size c7-core's whole reads take. */
const WHOLE_READ_PAGE = 500

/**
 * EVERY open incident `filter` finds, newest first, page by page until a shorter page: for a view
 * that must tell a call activity's copies from its root incidents exactly (an activity's page at a
 * call activity), the named exception to "never a scan", since the read is whole and never a
 * capped page. Primary: a failed page fails the read.
 */
export async function readAllIncidents(
  client: Client,
  filter: { processDefinitionKeyIn: string; activityId: string },
): Promise<IncidentRow[]> {
  const rows: IncidentRow[] = []
  for (;;) {
    const page = rowsOf<IncidentRow>(
      await getIncidents({
        client,
        query: {
          ...filter,
          sortBy: "incidentTimestamp",
          sortOrder: "desc",
          firstResult: rows.length,
          maxResults: WHOLE_READ_PAGE,
        },
      }),
    )
    rows.push(...page)
    if (page.length < WHOLE_READ_PAGE) return rows
  }
}

export function groupBy<T>(rows: T[], by: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = by(r)
    const list = map.get(k) ?? []
    list.push(r)
    map.set(k, list)
  }
  return map
}

export function isOnOrAfter(timestamp: string | null | undefined, cutoffMs: number): boolean {
  const ms = engineDateMillis(timestamp)
  return ms !== null && ms >= cutoffMs
}

export interface ScanFacts {
  representativeMessage: string | null
  /** Exact whenever the group appears in the scan (newest first). */
  latestIncident: string | null
  firstSeen: string | null
}

/**
 * `fullyScanned` must be decided against an exact count, never the scan's
 * completeness: a complete scan whose rows a view cannot attribute must not vouch.
 */
export function scanFacts(groupRows: IncidentRow[], options: { fullyScanned: boolean }): ScanFacts {
  const timestamps = groupRows.map((r) => r.incidentTimestamp)
  return {
    representativeMessage: groupRows[0]?.incidentMessage ?? null,
    latestIncident: latestEngineDate(timestamps),
    firstSeen: options.fullyScanned ? earliestEngineDate(timestamps) : null,
  }
}

/** ONE read for the page; propagates, so enrichment callers wrap it in `optional(...)`. */
export async function fetchBusinessKeys(
  client: Client,
  instanceIds: Iterable<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set([...instanceIds].filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  const rows = rowsOf<{ id?: string | null; businessKey?: string | null }>(
    await getProcessInstances({
      client,
      query: { processInstanceIds: ids.join(","), maxResults: ids.length },
    }),
  )
  return new Map(
    rows
      .filter((row): row is { id: string; businessKey?: string | null } => !!row.id)
      .map((row) => [row.id, row.businessKey ?? null]),
  )
}

/** At most this many root incidents per page: past it a copy shows no root, as an unread one. */
export const ROOT_CAUSE_READS = 25

interface RawRootIncident {
  id?: string | null
  processDefinitionId?: string | null
  processInstanceId?: string | null
  activityId?: string | null
  incidentMessage?: string | null
}

/**
 * ENRICHMENT, a page's copies (a call activity's copy of a called instance's incident, which holds
 * no message of its own): each root incident once, by its id, since the engine filters incidents by
 * one id only (at most {@link ROOT_CAUSE_READS}, {@link PARALLEL} at a time), and its element's name
 * from its diagram. Keyed by the copy's id; a copy whose root is unread is left out, so its message
 * shows "—", never a guess.
 */
export async function fetchRootCauses(
  client: Client,
  rows: ReadonlyArray<{ id?: string | null; rootCauseIncidentId?: string | null }>,
): Promise<Map<string, IncidentRootCause>> {
  const copies = rows.flatMap((row) => {
    const rootId = rootIdOfCopy(row)
    return row.id && rootId !== undefined ? [{ id: row.id, rootId }] : []
  })
  const rootIds = [...new Set(copies.map((copy) => copy.rootId))].slice(0, ROOT_CAUSE_READS)
  if (rootIds.length === 0) return new Map()
  const read = await mapLimit(rootIds, PARALLEL, (id) =>
    optional(getIncident({ client, path: { id } }) as Promise<RawRootIncident>),
  )
  const roots = read.filter(
    (root): root is RawRootIncident & { id: string; processInstanceId: string } =>
      !!root?.id && !!root.processInstanceId,
  )
  const names = await fetchNamesByDefinition(
    client,
    roots.map((root) => root.processDefinitionId),
  )
  const byRoot = new Map(
    roots.map((root): [string, IncidentRootCause] => [
      root.id,
      {
        incidentId: root.id,
        message: root.incidentMessage || null,
        activityId: root.activityId ?? "",
        activityName: elementNameIn(names, root.processDefinitionId, root.activityId),
        processInstanceId: root.processInstanceId,
      },
    ]),
  )
  return new Map(
    copies.flatMap((copy) => {
      const root = byRoot.get(copy.rootId)
      return root ? [[copy.id, root] as const] : []
    }),
  )
}

export interface IncidentLinkContext {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
  processDefinitionKey: string
}

/**
 * The cockpit link uses the view's key (a bare definition id names none) and the
 * row's OWN version, not the key's latest: no definition lookup per page.
 */
export function toIncidentInstance(
  r: IncidentRow,
  ctx: IncidentLinkContext,
  businessKeys?: Map<string, string | null> | null,
  activityName: string | null = null,
): IncidentInstance {
  return {
    id: r.id,
    processInstanceId: r.processInstanceId,
    businessKey: businessKeys?.get(r.processInstanceId) ?? null,
    incidentType: r.incidentType,
    incidentMessage: r.incidentMessage ?? null,
    incidentTimestamp: r.incidentTimestamp,
    activityId: r.activityId,
    activityName,
    recovery: incidentRecovery(r),
    cockpitInstanceUrl: buildInstanceCockpitUrl(
      ctx,
      {
        key: ctx.processDefinitionKey,
        version: definitionVersionFromId(r.processDefinitionId),
        definitionId: r.processDefinitionId,
        instanceId: r.processInstanceId,
      },
      // Drill-in from an incident list: the operator is debugging failures.
      { tab: "incidents" },
    ),
    rootIncidentId: rootIdOfCopy(r) ?? null,
  }
}
