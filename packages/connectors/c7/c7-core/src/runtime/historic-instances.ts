/**
 * The history's process instances (`POST /history/process-instance` and its count): the query in
 * the body, so a thousand instance ids fit, the rows newest first and then by id, so no page
 * repeats or skips one, each read through `JsonView`; and a row as the engine contract's
 * `InstanceSummary`.
 */

import { InstanceId, type InstanceSummary } from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { compact } from "../util.js"
import { definitionRefOfInstance } from "./definition-refs.js"
import { instanceStateOf } from "./instance-states.js"
import { JsonView } from "./json-view.js"
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

/** The newest instance first; the id breaks a tie, so a page is stable. */
const NEWEST_FIRST = [
  { sortBy: "startTime", sortOrder: "desc" },
  { sortBy: "instanceId", sortOrder: "asc" },
] as const

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
      startTime: record.optionalString("startTime"),
      endTime: record.optionalString("endTime"),
      superProcessInstanceId: record.optionalString("superProcessInstanceId"),
    }),
  }
}

/** The rows `window` of the instances `query` finds, newest first. */
export async function readHistoricInstances(
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

/** How many instances `query` finds. */
export async function countHistoricInstances(
  port: EnginePort,
  query: HistoricInstanceQuery,
): Promise<number> {
  const answer = await port.json("queryHistoricProcessInstancesCount", {
    pathArgs: [],
    query: {},
    body: query,
  })
  return JsonView.of(answer, "historic process instance count").requiredNumber("count")
}

/** `row` as the contract's summary of an instance, flagged when it holds an open incident. */
export function instanceSummaryOf(row: HistoricInstanceRow, hasIncident: boolean): InstanceSummary {
  return {
    id: InstanceId(row.id),
    definition: definitionRefOfInstance(row),
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
