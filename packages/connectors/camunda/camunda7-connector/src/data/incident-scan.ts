import {
  earliestEngineDate,
  engineDateMillis,
  incidentRecovery,
  latestEngineDate,
  type Client,
} from "@miragon/pulse-camunda7-client"
import { getIncidents, getProcessInstances } from "@miragon/pulse-camunda7-client/sdk"
import type { IncidentInstance } from "../view-models.js"
import type { EngineProvider } from "../engine-provider.js"
import { buildInstanceCockpitUrl } from "../lib/cockpit-url.js"
import { definitionVersionFromId } from "./definition-info.js"
import { INCIDENT_SCAN_LIMIT, rowsOf } from "./engine-reads.js"

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
}

export interface IncidentScan {
  rows: IncidentRow[]
  /** The engine returned fewer than the limit. */
  complete: boolean
  /** The oldest row predates `sinceMs`, so every incident since then is in `rows`. */
  reachesBefore: (sinceMs: number) => boolean
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
  const complete = rows.length < INCIDENT_SCAN_LIMIT
  const oldest = engineDateMillis(earliestEngineDate(rows.map((r) => r.incidentTimestamp)))
  return {
    rows,
    complete,
    reachesBefore: (sinceMs) => oldest !== null && oldest < sinceMs,
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
  last24hCount: number | null
}

/**
 * `fullyScanned` must be decided against an exact count, never the scan's
 * completeness: a complete scan whose rows a view cannot attribute must not vouch.
 */
export function scanFacts(
  groupRows: IncidentRow[],
  options: { fullyScanned: boolean; scan: IncidentScan; cutoffMs: number },
): ScanFacts {
  const timestamps = groupRows.map((r) => r.incidentTimestamp)
  return {
    representativeMessage: groupRows[0]?.incidentMessage ?? null,
    latestIncident: latestEngineDate(timestamps),
    firstSeen: options.fullyScanned ? earliestEngineDate(timestamps) : null,
    last24hCount:
      options.fullyScanned || options.scan.reachesBefore(options.cutoffMs)
        ? timestamps.filter((ts) => isOnOrAfter(ts, options.cutoffMs)).length
        : null,
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
): IncidentInstance {
  return {
    id: r.id,
    processInstanceId: r.processInstanceId,
    businessKey: businessKeys?.get(r.processInstanceId) ?? null,
    incidentType: r.incidentType,
    incidentMessage: r.incidentMessage ?? null,
    incidentTimestamp: r.incidentTimestamp,
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
  }
}
