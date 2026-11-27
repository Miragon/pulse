/**
 * The definition statistics of an engine (`/process-definition/statistics` with
 * `rootIncidents=true`), read and folded once for every surface. Per deployed version: its running
 * instances, its failed jobs where the read asks for them (`failedJobs`, else the engine counts
 * none) and its open root incidents per incident type (a copy a call activity holds of an incident
 * in a called instance is no root incident). Per process key (`statisticsByKey`): the latest
 * version, the one with the highest version number and the first listed of equal ones, the sums
 * over every version and the versions that hold a root incident, of one incident type where one is
 * named. The status triage, the contract's processes and the MCP server's overview, incidents
 * dashboard and process incidents take a key's numbers from this fold, so a key counts the same on
 * every surface. A key spans the versions of every tenant. The answer is read through `JsonView`,
 * so an unusable one fails as `RuntimeError("unexpectedResponse")`, never as a row left out or
 * counted under another key.
 */

import { JsonView } from "./json-view.js"
import type { EnginePort, Query } from "./port.js"
import { queryInput } from "./requests.js"
import { compact } from "./util.js"

/** A deployed version of a process: its id, key, version and what it names. */
export interface DefinitionRow {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly name?: string
  readonly deploymentId?: string
  readonly versionTag?: string
}

/** A version with the count of its running instances, its failed jobs and its open root incidents. */
export interface DefinitionStatisticsRow {
  readonly definition: DefinitionRow
  readonly instances: number
  /** Its jobs without retries left; 0 where the read did not ask for them. */
  readonly failedJobs: number
  /** Its open root incidents per incident type, in the order the engine lists the types. */
  readonly incidentsByType: ReadonlyMap<string, number>
  /** Its open root incidents, the sum over their types. */
  readonly rootIncidents: number
}

/** What the statistics read asks for beside the root incidents. */
export interface StatisticsOptions {
  /** Whether the engine counts the failed jobs of each version too. */
  readonly failedJobs?: boolean
}

/** The query of the statistics read: the root incidents, and the failed jobs where asked. */
export function definitionStatisticsQuery(options: StatisticsOptions = {}): Query {
  return options.failedJobs === true
    ? { failedJobs: "true", rootIncidents: "true" }
    : { rootIncidents: "true" }
}

function definitionRowOf(record: JsonView): DefinitionRow {
  return {
    id: record.requiredString("id"),
    key: record.requiredString("key"),
    version: record.requiredNumber("version"),
    ...compact({
      name: record.optionalString("name"),
      deploymentId: record.optionalString("deploymentId"),
      versionTag: record.optionalString("versionTag"),
    }),
  }
}

/**
 * The versions of a definitions list (`GET /process-definition`), in the order the engine lists
 * them, read as the statistics read a row's definition.
 */
export function definitionRowsOf(answer: unknown): DefinitionRow[] {
  return JsonView.listOf(answer, "definitions").map((record) => definitionRowOf(record))
}

function sum(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/** The open root incidents of a statistics row per incident type. */
function incidentsByTypeOf(row: JsonView): Map<string, number> {
  const byType = new Map<string, number>()
  for (const entry of row.optionalList("incidents")) {
    const type = entry.requiredString("incidentType")
    byType.set(type, (byType.get(type) ?? 0) + entry.requiredNumber("incidentCount"))
  }
  return byType
}

/** The rows of a statistics answer, in the order the engine lists them. */
export function definitionStatisticsOf(answer: unknown): DefinitionStatisticsRow[] {
  return JsonView.listOf(answer, "definition statistics").map((row) => {
    const definition = definitionRowOf(row.object("definition", "statistics definition"))
    const instances = row.requiredNumber("instances")
    const failedJobs = row.optionalNumber("failedJobs") ?? 0
    const incidentsByType = incidentsByTypeOf(row)
    return {
      definition,
      instances,
      failedJobs,
      incidentsByType,
      rootIncidents: sum(incidentsByType.values()),
    }
  })
}

/**
 * Every deployed version with its running instances and open root incidents, its failed jobs where
 * `options` asks for them, in one request: the one statistics read, which the definitions and
 * versions read for their counts, the root incidents one grouped subquery over the open incidents
 * beside the instances it already counts. A read that only names versions (the incident search's,
 * the called processes') asks for them by their ids or keys instead (`readDefinitionRows`).
 */
export async function readDefinitionStatistics(
  port: EnginePort,
  options: StatisticsOptions = {},
): Promise<DefinitionStatisticsRow[]> {
  const query = queryInput(definitionStatisticsQuery(options))
  return definitionStatisticsOf(await port.json("getProcessDefinitionStatistics", query))
}

/** A process key's statistics over every version deployed under it. */
export interface ProcessStatistics {
  readonly key: string
  /** The version with the highest version number, the first listed of equal ones. */
  readonly latest: DefinitionRow
  /** Its versions, in the order the engine lists them. */
  readonly versions: readonly DefinitionStatisticsRow[]
  readonly instances: number
  readonly failedJobs: number
  /** Its open root incidents per incident type, of the one type asked for where one was. */
  readonly incidentsByType: ReadonlyMap<string, number>
  /** Its open root incidents, of the one type asked for where one was. */
  readonly rootIncidents: number
  /** The ids of its versions that hold such a root incident. */
  readonly incidentVersionIds: readonly string[]
}

/** A row's root incidents per type, of `incidentType` alone where one is named. */
function countedTypes(
  row: DefinitionStatisticsRow,
  incidentType: string | undefined,
): ReadonlyMap<string, number> {
  if (incidentType === undefined) return row.incidentsByType
  const count = row.incidentsByType.get(incidentType)
  return new Map(count === undefined ? [] : [[incidentType, count]])
}

function processOf(
  key: string,
  versions: readonly DefinitionStatisticsRow[],
  incidentType: string | undefined,
): ProcessStatistics {
  const incidentsByType = new Map<string, number>()
  const incidentVersionIds: string[] = []
  for (const row of versions) {
    const counted = countedTypes(row, incidentType)
    for (const [type, count] of counted) {
      incidentsByType.set(type, (incidentsByType.get(type) ?? 0) + count)
    }
    if (sum(counted.values()) > 0) incidentVersionIds.push(row.definition.id)
  }
  return {
    key,
    latest: versions
      .map((row) => row.definition)
      .reduce((latest, definition) => (definition.version > latest.version ? definition : latest)),
    versions,
    instances: sum(versions.map((row) => row.instances)),
    failedJobs: sum(versions.map((row) => row.failedJobs)),
    incidentsByType,
    rootIncidents: sum(incidentsByType.values()),
    incidentVersionIds,
  }
}

/**
 * The statistics per process key, in the order the engine first lists each key; with
 * `incidentType`, a key's root incidents are those of that type alone (the engine counts them per
 * type, and `rootIncidents=true` takes no type of its own).
 */
export function statisticsByKey(
  rows: readonly DefinitionStatisticsRow[],
  incidentType?: string,
): Map<string, ProcessStatistics> {
  const versionsByKey = new Map<string, DefinitionStatisticsRow[]>()
  for (const row of rows) {
    const versions = versionsByKey.get(row.definition.key)
    if (versions === undefined) versionsByKey.set(row.definition.key, [row])
    else versions.push(row)
  }
  return new Map(
    [...versionsByKey].map(([key, versions]) => [key, processOf(key, versions, incidentType)]),
  )
}
