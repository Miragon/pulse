import type { Client } from "@miragon/pulse-camunda7-client"
import {
  getProcessDefinitionStatistics,
  getProcessDefinitions,
} from "@miragon/pulse-camunda7-client/sdk"
import {
  bpmnProcessNameOf,
  readBpmnNames,
  type BpmnModelNames,
} from "@miragon/pulse-widget-shell/server"
import { fetchDefinitionXml } from "../lib/definition-xml.js"
import { rowsOf } from "./engine-reads.js"

export { fetchDefinitionXml }

// A key spans every deployed version (old ones keep running after a redeploy):
// a view about a key sums over all of them; only a diagram is one version.

export interface DefinitionInfo {
  id: string
  key: string
  name: string | null
  version: number
}

/**
 * Ids are `<key>:<version>:<deploymentId>`, but past 64 chars the engine uses a
 * bare generated id that names no key (null). Keys never contain `:` (NCName).
 */
export function definitionKeyInId(id: string): string | null {
  const idx = id.indexOf(":")
  return idx > 0 ? id.slice(0, idx) : null
}

/** Display fallback only: a key that scopes a query or link resolves the id ({@link resolveDefinitionKeys}). */
export function processDefinitionKeyFromId(id: string): string {
  return definitionKeyInId(id) ?? id
}

export function definitionVersionFromId(id: string | null | undefined): number | null {
  const segment = id?.split(":")[1]
  return segment && /^\d+$/.test(segment) ? Number(segment) : null
}

interface RawDefinition {
  id?: string | null
  key?: string | null
  name?: string | null
  version?: number | null
}

function toDefinitionInfo(raw: RawDefinition, key: string): DefinitionInfo {
  return {
    id: raw.id ?? "",
    key: raw.key ?? key,
    name: raw.name ?? null,
    version: typeof raw.version === "number" ? raw.version : (definitionVersionFromId(raw.id) ?? 0),
  }
}

/**
 * Over EVERY tenant. `GET /process-definition/key/{key}` finds only tenant-less
 * definitions, so a tenant deployment would read as unknown.
 */
export async function findLatestDefinition(
  client: Client,
  key: string,
): Promise<DefinitionInfo | null> {
  const [latest] = rowsOf<RawDefinition>(
    await getProcessDefinitions({
      client,
      query: { key, latestVersion: true, sortBy: "version", sortOrder: "desc", maxResults: 1 },
    }),
  )
  return latest ? toDefinitionInfo(latest, key) : null
}

/** An unknown key propagates as not-found: a mistyped key is never a view of zeros. */
export async function fetchLatestDefinition(client: Client, key: string): Promise<DefinitionInfo> {
  const latest = await findLatestDefinition(client, key)
  if (!latest) throw unknownKeyError(key)
  return latest
}

export function unknownKeyError(key: string): Error {
  return new Error(`No process definition with key "${key}" is deployed on this engine.`)
}

/** Names are enrichment: a definition past the cap shows its ids. */
export const NAMED_DEFINITIONS_LIMIT = 8

export type NamesByDefinition = ReadonlyMap<string, BpmnModelNames>

/** ENRICHMENT: a failed (or XML-less) read leaves its id out, so its names are null. */
export async function fetchNamesByDefinition(
  client: Client,
  definitionIds: Iterable<string | null | undefined>,
): Promise<NamesByDefinition> {
  const ids = [...new Set([...definitionIds].filter((id): id is string => !!id))].slice(
    0,
    NAMED_DEFINITIONS_LIMIT,
  )
  const read = await Promise.all(
    ids.map(async (id) => {
      const xml = await fetchDefinitionXml(client, id).catch(() => null)
      return xml ? ([id, readBpmnNames(xml)] as const) : null
    }),
  )
  return new Map(read.filter((entry) => entry !== null))
}

export function processNameIn(
  names: NamesByDefinition,
  definitionId: string | null | undefined,
  key: string | null | undefined,
): string | null {
  const model = definitionId ? names.get(definitionId) : undefined
  return model && key ? bpmnProcessNameOf(model, key) : null
}

export function elementNameIn(
  names: NamesByDefinition,
  definitionId: string | null | undefined,
  elementId: string | null | undefined,
): string | null {
  const elements = definitionId ? names.get(definitionId)?.elements : undefined
  return elements && elementId && Object.hasOwn(elements, elementId) ? elements[elementId] : null
}

export interface NameableDefinition {
  id?: string | null
  key?: string | null
  name?: string | null
}

/**
 * Mutates in place. The engine names a process from `<process>` only, while the
 * Modeler names the POOL; without this camunda7 showed `miraveloLeasing` where
 * analytics shows "Miravelo - Bike Leasing". A diagram without names keeps null.
 */
export async function nameUnnamedDefinitions<T extends NameableDefinition>(
  client: Client,
  definitions: T[],
): Promise<T[]> {
  const unnamed = definitions.filter((d) => !d.name && d.id && d.key)
  if (unnamed.length === 0) return definitions
  const names = await fetchNamesByDefinition(
    client,
    unnamed.map((d) => d.id),
  )
  for (const definition of unnamed) {
    definition.name = processNameIn(names, definition.id, definition.key) ?? definition.name ?? null
  }
  return definitions
}

/** ONE read for the whole set; propagates, so enrichment callers wrap it in `optional(...)`. */
export async function fetchDefinitionsById(
  client: Client,
  definitionIds: Iterable<string | null | undefined>,
): Promise<Map<string, DefinitionInfo>> {
  const ids = [...new Set([...definitionIds].filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  const rows = rowsOf<RawDefinition>(
    await getProcessDefinitions({
      client,
      query: { processDefinitionIdIn: ids.join(","), maxResults: ids.length },
    }),
  )
  return new Map(
    rows
      .filter((row): row is RawDefinition & { id: string } => !!row.id)
      .map((row) => [row.id, toDefinitionInfo(row, row.key ?? definitionKeyInId(row.id) ?? "")]),
  )
}

/** Never `GET /process-definition/key/{key}/xml`: it only finds tenant-less definitions. */
export async function fetchLatestDefinitionXml(
  client: Client,
  key: string,
): Promise<string | null> {
  const latest = await findLatestDefinition(client, key)
  return latest?.id ? fetchDefinitionXml(client, latest.id) : null
}

interface IncidentStatRow {
  incidentType?: string | null
  incidentCount?: number | null
}

interface DefinitionStatsRow {
  id?: string | null
  instances?: number | null
  failedJobs?: number | null
  incidents?: IncidentStatRow[] | null
  definition?: RawDefinition | null
}

export interface KeyStats {
  latest: DefinitionInfo
  instances: number
  failedJobs: number
  incidentsByType: Map<string, number>
  incidentCount: number
  /** Where activity statistics are read. */
  incidentVersionIds: string[]
  versionIds: string[]
}

function incidentSum(row: DefinitionStatsRow): number {
  return (row.incidents ?? []).reduce((sum, i) => sum + (i.incidentCount ?? 0), 0)
}

function addVersion(stats: KeyStats, row: DefinitionStatsRow, version: DefinitionInfo): void {
  stats.instances += row.instances ?? 0
  stats.failedJobs += row.failedJobs ?? 0
  for (const incident of row.incidents ?? []) {
    const type = incident.incidentType ?? "unknown"
    stats.incidentsByType.set(
      type,
      (stats.incidentsByType.get(type) ?? 0) + (incident.incidentCount ?? 0),
    )
  }
  const incidents = incidentSum(row)
  stats.incidentCount += incidents
  if (incidents > 0 && version.id) stats.incidentVersionIds.push(version.id)
  if (version.id) stats.versionIds.push(version.id)
  if (version.version > stats.latest.version) stats.latest = version
}

/** Rows without a key cannot be attributed and are skipped. */
export function foldStatsByKey(rows: unknown): Map<string, KeyStats> {
  const byKey = new Map<string, KeyStats>()
  for (const row of rowsOf<DefinitionStatsRow>(rows)) {
    const key = row.definition?.key
    if (!key) continue
    const version = toDefinitionInfo({ ...row.definition, id: row.definition?.id ?? row.id }, key)
    const stats = byKey.get(key) ?? {
      latest: version,
      instances: 0,
      failedJobs: 0,
      incidentsByType: new Map<string, number>(),
      incidentCount: 0,
      incidentVersionIds: [],
      versionIds: [],
    }
    addVersion(stats, row, version)
    byKey.set(key, stats)
  }
  return byKey
}

/** An id missing from the statistics (deployed since) falls back to the key it names; a bare one is null, never a UUID. */
export function definitionKeyResolver(
  statsByKey: Map<string, KeyStats>,
): (definitionId: string) => string | null {
  const keyById = new Map<string, string>()
  for (const [key, stats] of statsByKey) {
    for (const id of stats.versionIds) keyById.set(id, key)
  }
  return (definitionId) => keyById.get(definitionId) ?? definitionKeyInId(definitionId)
}

/** ONE engine-wide call (no key filter), so read it only when a view spans keys. */
export async function fetchStatsByKey(
  client: Client,
  query: { failedJobs?: boolean; incidentsForType?: string },
): Promise<Map<string, KeyStats>> {
  // `incidentsForType` narrows the incident counts to one type; without it
  // every type is counted (`incidents: true`). The engine takes one or the other.
  const stats = await getProcessDefinitionStatistics({
    client,
    query: {
      failedJobs: query.failedJobs,
      ...(query.incidentsForType
        ? { incidentsForType: query.incidentsForType }
        : { incidents: true }),
    },
  })
  return foldStatsByKey(stats)
}

/** Statistics are read only for bare generated ids, so short keys cost no call. */
export async function resolveDefinitionKeys(
  client: Client,
  definitionIds: Iterable<string | null | undefined>,
): Promise<(definitionId: string) => string | null> {
  for (const id of definitionIds) {
    if (id && definitionKeyInId(id) === null) {
      return definitionKeyResolver(await fetchStatsByKey(client, {}))
    }
  }
  return definitionKeyInId
}
