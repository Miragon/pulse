/**
 * A process of the cockpit: a key in one tenant (null for none), as engine-core names a process
 * (owner decision 2026-11-26). The process route and an activity's page of incidents read one
 * process by its key's latest versions (`fetchLatestVersions`: Camunda 7 answers one per tenant,
 * the read that named the key's latest before), its flow by its key's every version, which it
 * sums: the tenant the call names, else the one engine-core's `ProcessTenants` names (the key's
 * process without a tenant where the key has a version without one, else its first tenant by id),
 * its latest version, and whether it is alone, its key deployed in its tenant alone (every key on
 * an engine without tenants). A process alone reads its key, as every read did before; one whose
 * key holds others narrows each read to it: its counts by `tenantQuery`, its statistics by the fold
 * per process, its incidents by the ids of its versions that hold one (`scanOfProcess`, `GET
 * /incident` naming one version and no process without a tenant), so a tenant's numbers and facts
 * are never another's.
 */

import type { Client } from "@miragon/pulse-c7-client"
import {
  type DefinitionStatisticsRow,
  engineTime,
  mapLimit,
  PARALLEL,
} from "@miragon/pulse-c7-core"
import { ProcessTenants, TenantId } from "@miragon/pulse-engine-core"
import {
  type DefinitionVersion,
  fetchDefinitionVersions,
  fetchLatestVersions,
  foldStatsByKey,
  foldStatsByProcess,
  type KeyStats,
  unknownKeyError,
} from "./definition-info.js"
import { INCIDENT_SCAN_LIMIT } from "./engine-reads.js"
import { type IncidentRow, type IncidentScan, scanIncidents } from "./incident-scan.js"

/** A key in one tenant, its latest version read. */
export interface CockpitProcess {
  readonly key: string
  /** Its tenant; null for none. */
  readonly tenantId: string | null
  /** Its latest version: the one with the highest number in its tenant. */
  readonly latest: DefinitionVersion
  /** Whether every version of the key is the process's: a read of the key is then its read. */
  readonly alone: boolean
}

/** A process with its every version, newest first. */
export interface ProcessVersions extends CockpitProcess {
  readonly versions: readonly DefinitionVersion[]
}

/** A key the engine deploys, but in other tenants than the one asked for. */
function unknownProcessError(key: string, tenantId: string | null): Error {
  return tenantId === null
    ? new Error(
        `No process definition with key "${key}" is deployed without a tenant on this engine.`,
      )
    : new Error(
        `No process definition with key "${key}" is deployed in tenant "${tenantId}" on this engine.`,
      )
}

/**
 * The process the key `key` names among `rows` (its versions, newest first: every one, or its
 * latest per tenant) in the tenant `tenantId` (null: none), without one the process
 * `ProcessTenants` names. PRIMARY: a key without a version fails as not found
 * (`unknownKeyError`), and so does a tenant that holds none (`unknownProcessError`), never a view
 * of zeros.
 */
function processAmong(
  key: string,
  rows: readonly DefinitionVersion[],
  tenantId: string | null | undefined,
): ProcessVersions {
  const tenants = rows.map(({ tenantId: id }) => (id === null ? null : TenantId(id)))
  const tenant = tenantId === undefined ? ProcessTenants.tenantOf(tenants) : tenantId
  if (rows.length === 0 || tenant === undefined) throw unknownKeyError(key)
  const versions = rows.filter((version) => version.tenantId === tenant)
  const [latest] = versions
  if (latest === undefined) throw unknownProcessError(key, tenant)
  return { key, tenantId: tenant, latest, alone: versions.length === rows.length, versions }
}

/** The process the key `key` names in the tenant `tenantId` (`processAmong`), by its latest per tenant. */
export async function readCockpitProcess(
  client: Client,
  key: string,
  tenantId?: string | null,
): Promise<CockpitProcess> {
  const process = processAmong(key, await fetchLatestVersions(client, key), tenantId)
  return { key, tenantId: process.tenantId, latest: process.latest, alone: process.alone }
}

/** The process the key `key` names in the tenant `tenantId`, with its every version (one read). */
export async function readProcessVersions(
  client: Client,
  key: string,
  tenantId?: string | null,
): Promise<ProcessVersions> {
  return processAmong(key, await fetchDefinitionVersions(client, key), tenantId)
}

/** Whether a row of the key `key` in the tenant `tenantId` is the process's. */
export function holds(
  process: CockpitProcess,
  { key, tenantId }: { readonly key: string; readonly tenantId: string | null },
): boolean {
  return key === process.key && (process.alone || tenantId === process.tenantId)
}

/**
 * The process's statistics: its key's where it is alone (c7-core's fold per key, as the route
 * always read them), else its versions' (the fold per process); none where the statistics list
 * none of it (deployed since the floored read).
 */
export function statsOfProcess(
  rows: readonly DefinitionStatisticsRow[],
  process: CockpitProcess,
): KeyStats | undefined {
  if (process.alone) return foldStatsByKey(rows).get(process.key)
  return foldStatsByProcess(rows).find((stats) => holds(process, stats))
}

/** The newer of two incidents first, by instant (the engine's offsets may differ), then by id. */
function newestFirst(left: IncidentRow, right: IncidentRow): number {
  const time = (row: IncidentRow) => engineTime(row.incidentTimestamp) ?? 0
  return time(right) - time(left) || left.id.localeCompare(right.id)
}

/**
 * The newest open incidents of the process, `INCIDENT_SCAN_LIMIT` at most: its key's where it is
 * alone, else those of its versions that hold a root incident (`stats`, the same floored read its
 * counts come from), each read by its id, `PARALLEL` at a time, merged newest first; complete where
 * each version's read holds every one of its incidents and they fit the limit. Another tenant's
 * incidents are never read, so its load never pushes the process's out of the scan.
 */
export async function scanOfProcess(
  client: Client,
  process: CockpitProcess,
  stats: KeyStats | undefined,
): Promise<IncidentScan> {
  if (process.alone) return scanIncidents(client, { processDefinitionKeyIn: process.key })
  const scans = await mapLimit(stats?.incidentVersionIds ?? [], PARALLEL, (id) =>
    scanIncidents(client, { processDefinitionId: id }),
  )
  const rows = scans.flatMap((scan) => scan.rows).sort(newestFirst)
  return {
    rows: rows.slice(0, INCIDENT_SCAN_LIMIT),
    complete: scans.every((scan) => scan.complete) && rows.length <= INCIDENT_SCAN_LIMIT,
  }
}

/** The ids of the process's versions an incident search reads; none where it reads its key. */
export function incidentVersionsOf(
  process: CockpitProcess,
  stats: KeyStats | undefined,
): readonly string[] | undefined {
  return process.alone ? undefined : (stats?.incidentVersionIds ?? [])
}
