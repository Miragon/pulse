/**
 * The history's process instances (`POST /history/process-instance` and its count): the query in
 * the body, the rows newest first and then by id, so no page repeats or skips one, each read
 * through `JsonView`; and a row as the engine contract's `InstanceSummary`. A query that names
 * more instance ids than one request carries (500 by default) goes in chunks of them, its count
 * the sum of theirs and its window the merge of theirs (`history-chunks.ts`).
 */

import { InstanceId, type InstanceSummary } from "@miragon/pulse-engine-core"
import { type EnginePort, PARALLEL } from "../port.js"
import { compact, mapLimit } from "../util.js"
import { definitionRefOfInstance, type VersionTenants } from "./definition-refs.js"
import {
  chunkedQueries,
  HISTORY_ID_CHUNK,
  mergedNewestFirst,
  NEWEST_FIRST,
} from "./history-chunks.js"
import { instanceStateOf } from "./instance-states.js"
import { JsonView } from "../json-view.js"
import type { OffsetWindow } from "./offset-paging.js"
import { optionalTimestampOf } from "./timestamps.js"

/** An instance as the history lists it. */
export interface HistoricInstanceRow {
  readonly id: string
  readonly businessKey?: string
  readonly processDefinitionId: string
  readonly processDefinitionKey: string
  readonly processDefinitionVersion: number
  readonly processDefinitionName?: string
  readonly tenantId?: string
  readonly state: string
  readonly startTime?: string
  readonly endTime?: string
  readonly superProcessInstanceId?: string
}

/** A condition on a variable of the history's query, its value as the engine reads it. */
export interface VariableQueryCondition {
  readonly name: string
  readonly operator: "eq" | "neq" | "gt" | "lt" | "like"
  readonly value: unknown
}

/** The history's instance query, the body of the search and of its count. */
export interface HistoricInstanceQuery {
  readonly processDefinitionId?: string
  readonly processDefinitionKey?: string
  readonly processInstanceIds?: readonly string[]
  readonly processInstanceBusinessKey?: string
  readonly unfinished?: true
  readonly finished?: true
  readonly activityIdIn?: readonly string[]
  readonly variables?: readonly VariableQueryCondition[]
}

function rowOf(record: JsonView): HistoricInstanceRow {
  return {
    id: record.requiredString("id"),
    processDefinitionId: record.requiredString("processDefinitionId"),
    processDefinitionKey: record.requiredString("processDefinitionKey"),
    processDefinitionVersion: record.requiredNumber("processDefinitionVersion"),
    state: record.requiredString("state"),
    ...compact({
      businessKey: record.optionalString("businessKey"),
      processDefinitionName: record.optionalString("processDefinitionName"),
      tenantId: record.optionalString("tenantId"),
      startTime: record.optionalString("startTime"),
      endTime: record.optionalString("endTime"),
      superProcessInstanceId: record.optionalString("superProcessInstanceId"),
    }),
  }
}

/** The rows `window` of the instances `query` finds, newest first, in one request. */
async function readWindow(
  port: EnginePort,
  query: HistoricInstanceQuery,
  window: OffsetWindow,
): Promise<HistoricInstanceRow[]> {
  const answer = await port.json("queryHistoricProcessInstances", {
    pathArgs: [],
    query: { firstResult: String(window.firstResult), maxResults: String(window.maxResults) },
    body: { ...query, sorting: NEWEST_FIRST },
  })
  return JsonView.listOf(answer, "historic process instances").map((record) => rowOf(record))
}

/**
 * The rows `window` of the instances `query` finds, newest first: in one request while it names
 * at most `chunk` instance ids, else the merge of each chunk's rows from the first up to the
 * window's end, at most `chunk` of them, as the history holds one row per instance.
 */
export async function readHistoricInstances(
  port: EnginePort,
  query: HistoricInstanceQuery,
  window: OffsetWindow,
  chunk = HISTORY_ID_CHUNK,
): Promise<HistoricInstanceRow[]> {
  const queries = chunkedQueries(query, chunk)
  if (queries.length === 1) {
    return readWindow(port, queries[0], window)
  }
  const end = window.firstResult + window.maxResults
  const rows = { firstResult: 0, maxResults: Math.min(end, chunk) }
  const chunks = await mapLimit(queries, PARALLEL, (part) => readWindow(port, part, rows))
  return mergedNewestFirst(chunks, end).slice(window.firstResult)
}

/** How many instances `query` finds, in one request. */
async function countOnce(port: EnginePort, query: HistoricInstanceQuery): Promise<number> {
  const answer = await port.json("queryHistoricProcessInstancesCount", {
    pathArgs: [],
    query: {},
    body: query,
  })
  return JsonView.of(answer, "historic process instance count").requiredNumber("count")
}

/**
 * How many instances `query` finds: one count while it names at most `chunk` instance ids, else
 * the sum of each chunk's count.
 */
export async function countHistoricInstances(
  port: EnginePort,
  query: HistoricInstanceQuery,
  chunk = HISTORY_ID_CHUNK,
): Promise<number> {
  const counts = await mapLimit(chunkedQueries(query, chunk), PARALLEL, (part) =>
    countOnce(port, part),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}

/**
 * `row` as the contract's summary of an instance, flagged when it holds an open incident, its
 * version in the tenant `tenants` names (`versionTenantsOf`; none where it names none).
 */
export function instanceSummaryOf(
  row: HistoricInstanceRow,
  hasIncident: boolean,
  tenants: VersionTenants,
): InstanceSummary {
  return {
    id: InstanceId(row.id),
    definition: definitionRefOfInstance(row, tenants),
    state: instanceStateOf(row.state),
    hasIncident,
    ...compact({
      businessKey: row.businessKey,
      startedAt: optionalTimestampOf(row.startTime),
      endedAt: optionalTimestampOf(row.endTime),
      parentInstanceId:
        row.superProcessInstanceId === undefined
          ? undefined
          : InstanceId(row.superProcessInstanceId),
    }),
  }
}
