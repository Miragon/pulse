import type { Client } from "@miragon/pulse-c7-client"
import { getProcessDefinitions } from "@miragon/pulse-c7-client/sdk"
import {
  type DefinitionStatisticsRow,
  elementOfActivity,
  type ProcessStatistics,
  statisticsByKey,
} from "@miragon/pulse-c7-core"
import {
  bpmnProcessNameOf,
  readBpmnNames,
  type BpmnModelNames,
} from "@miragon/pulse-widget-shell/server"
import { fetchDefinitionXml } from "../lib/bpmn/definition-xml.js"
import { optional, rowsOf } from "./engine-reads.js"
import { readStatistics } from "./statistics-floor.js"

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
  historyTimeToLive?: number | null
  tenantId?: string | null
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
async function findLatestDefinition(client: Client, key: string): Promise<DefinitionInfo | null> {
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

/**
 * A deployed version, how many days the engine keeps its history (null: no limit) and its tenant
 * (null: none), whose own versions count on.
 */
export interface DefinitionVersion extends DefinitionInfo {
  historyTimeToLive: number | null
  tenantId: string | null
}

/**
 * Every deployed version of a key over every tenant, newest first, uncapped: a view that sums per
 * version reads them all, and only the key's own versions (never the engine-wide statistics).
 */
export async function fetchDefinitionVersions(
  client: Client,
  key: string,
): Promise<DefinitionVersion[]> {
  const rows = rowsOf<RawDefinition>(
    await getProcessDefinitions({ client, query: { key, sortBy: "version", sortOrder: "desc" } }),
  )
  return rows
    .filter((row) => !!row.id)
    .map((row) => ({
      ...toDefinitionInfo(row, key),
      historyTimeToLive: typeof row.historyTimeToLive === "number" ? row.historyTimeToLive : null,
      tenantId: row.tenantId ?? null,
    }))
}

/**
 * The ids of a key's versions deployed after `deployedAfter` (an engine date), over every tenant,
 * uncapped: with the version that was the latest at that time, the ones an instance started since
 * then most likely ran on.
 */
export async function fetchVersionIdsDeployedAfter(
  client: Client,
  key: string,
  deployedAfter: string,
): Promise<Set<string>> {
  const rows = rowsOf<RawDefinition>(
    await getProcessDefinitions({ client, query: { key, deployedAfter } }),
  )
  return new Set(rows.flatMap((row) => (row.id ? [row.id] : [])))
}

export function unknownKeyError(key: string): Error {
  return new Error(`No process definition with key "${key}" is deployed on this engine.`)
}

/** Names are enrichment: a definition past the cap shows its ids. */
export const NAMED_DEFINITIONS_LIMIT = 8

export type NamesByDefinition = ReadonlyMap<string, BpmnModelNames>

/**
 * ENRICHMENT: a failed (or XML-less) read leaves its id out, so its names are null; a failed one,
 * a read another call started and this one joined included, misses a part of the build over
 * `client` (`optional`).
 */
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
      const xml = await optional(fetchDefinitionXml(client, id), client)
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

/**
 * The name `definitionId`'s diagram gives the element an engine id stands for: a multi-instance
 * body's id (`<id>#multiInstanceBody`, which the diagram does not draw) by the activity it repeats
 * (`elementOfActivity`). Null where the diagram is unread or names none, so the id stands in.
 */
export function elementNameIn(
  names: NamesByDefinition,
  definitionId: string | null | undefined,
  activityId: string | null | undefined,
): string | null {
  const elements = definitionId ? names.get(definitionId)?.elements : undefined
  const elementId = activityId ? elementOfActivity(activityId) : undefined
  return elements && elementId && Object.hasOwn(elements, elementId) ? elements[elementId] : null
}

export interface NameableDefinition {
  id?: string | null
  key?: string | null
  name?: string | null
}

/**
 * Mutates in place. The engine names a process from `<process>` only, while the
 * Modeler names the POOL; without this the engine module showed `miraveloLeasing`, not
 * "Miravelo - Bike Leasing". A diagram without names keeps null.
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

/**
 * A key's statistics over every version, c7-core's one fold (`statisticsByKey`, which the status
 * triage and the contract's processes read too) with its latest version as this module names one.
 * Its incidents are its open ROOT incidents (the statistics read with `rootIncidents=true`): an
 * incident raised in one of its instances, never a call activity's copy of a called instance's
 * incident, which counts where it was raised (owner decision D2, amended on 2026-11-19, followed by
 * the cockpit on 2026-11-21).
 */
export interface KeyStats {
  latest: DefinitionInfo
  instances: number
  failedJobs: number
  /** Its open root incidents per incident type. */
  incidentsByType: Map<string, number>
  /** Its open root incidents, of the one type asked for where one was. */
  incidentCount: number
  /** The versions that hold a root incident. */
  incidentVersionIds: string[]
  /**
   * The versions that can hold a count on their diagram: running instances, jobs without retries
   * or open root incidents of any type. Every other version's element statistics are all zero.
   */
  heldVersionIds: string[]
  versionIds: string[]
}

/** Whether a version holds anything its element statistics could count. */
function holdsCounts(row: DefinitionStatisticsRow): boolean {
  return row.instances > 0 || row.failedJobs > 0 || row.rootIncidents > 0
}

function keyStatsOf(process: ProcessStatistics): KeyStats {
  const { id, key, name, version } = process.latest
  return {
    latest: { id, key, name: name ?? null, version },
    instances: process.instances,
    failedJobs: process.failedJobs,
    incidentsByType: new Map(process.incidentsByType),
    incidentCount: process.rootIncidents,
    incidentVersionIds: [...process.incidentVersionIds],
    heldVersionIds: process.versions.filter(holdsCounts).map((row) => row.definition.id),
    versionIds: process.versions.map((row) => row.definition.id),
  }
}

/**
 * The statistics per key; with `incidentType`, a key counts the incidents of that type alone. Rows
 * read without the failed jobs count none, so their versions hold counts by instances and incidents.
 */
export function foldStatsByKey(
  rows: readonly DefinitionStatisticsRow[],
  incidentType?: string,
): Map<string, KeyStats> {
  return new Map(
    [...statisticsByKey(rows, incidentType)].map(([key, process]) => [key, keyStatsOf(process)]),
  )
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

/** The statistics per key of one floored read, and when it was sent. */
export interface KeyStatsRead {
  statsByKey: Map<string, KeyStats>
  /** When the statistics read was sent (epoch milliseconds): the time a view's bar names. */
  readAt: number
}

/**
 * ONE engine-wide read (no key filter), so read it only when a view spans keys or needs a key's
 * root incidents: this engine's and caller's floored one (`readStatistics`, 30 s, the failed jobs
 * counted), folded per call. The engine counts each version's open root incidents per type
 * (`rootIncidents=true`, which takes no type of its own), so a type narrows the counts here.
 */
export async function fetchStatsRead(
  client: Client,
  options: { incidentType?: string } = {},
): Promise<KeyStatsRead> {
  const { rows, readAt } = await readStatistics(client)
  return { statsByKey: foldStatsByKey(rows, options.incidentType), readAt }
}

/** The statistics per key of the floored read (`fetchStatsRead`), where no time is named. */
export async function fetchStatsByKey(
  client: Client,
  options: { incidentType?: string } = {},
): Promise<Map<string, KeyStats>> {
  return (await fetchStatsRead(client, options)).statsByKey
}

/** The bare generated ids among `definitionIds`, each once: the ones no id names a key of. */
function bareIdsIn(definitionIds: Iterable<string | null | undefined>): string[] {
  const ids = [...definitionIds].filter(
    (id): id is string => !!id && definitionKeyInId(id) === null,
  )
  return [...new Set(ids)]
}

/**
 * Statistics are read only for bare generated ids, so short keys cost no call. The floored read
 * (`fetchStatsByKey`, up to 30 s old) lists no version deployed since, so a bare id it misses is
 * read by its id once (`fetchDefinitionsById`) before its key stays null.
 */
export async function resolveDefinitionKeys(
  client: Client,
  definitionIds: Iterable<string | null | undefined>,
): Promise<(definitionId: string) => string | null> {
  const bare = bareIdsIn(definitionIds)
  if (bare.length === 0) return definitionKeyInId
  const listed = definitionKeyResolver(await fetchStatsByKey(client))
  const missed = bare.filter((id) => listed(id) === null)
  if (missed.length === 0) return listed
  const deployed = await fetchDefinitionsById(client, missed)
  // A row that names no key reads "" (`toDefinitionInfo`): no key either.
  return (definitionId) => listed(definitionId) ?? (deployed.get(definitionId)?.key || null)
}
