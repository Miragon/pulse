/**
 * The engine contract's instance filter (`InstanceFilter` of @miragon/pulse-engine-core) as the
 * engine reads it: the history's instance query, whose `variables` take a condition's value as the
 * engine reads it (every integer beyond 2^53 in it digit for digit, a date in the engine's format,
 * `*` of a pattern as the engine's wildcard), and the scope of the runtime's "with incident"
 * (`with-incident.ts`). Pure.
 */

import type {
  InstanceFilter,
  VariableComparison,
  VariableCondition,
} from "@miragon/pulse-engine-core"
import { toEngineDate } from "../dates.js"
import { compact } from "../util.js"
import type { IncidentScope } from "../with-incident.js"
import type { HistoricInstanceQuery, VariableQueryCondition } from "./historic-instances.js"
import { parseExact } from "../raw-json.js"

const OPERATORS: Readonly<Record<VariableComparison, VariableQueryCondition["operator"]>> = {
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  lessThan: "lt",
}

/** The characters the engine's `like` reads as wildcards or as their escape. */
const SQL_WILDCARDS = /[\\%_]/g

/** A pattern with `*` as the engine's `%`, the engine's own wildcards and escape escaped. */
function likeOf(pattern: string): string {
  return pattern
    .split("*")
    .map((part) => part.replace(SQL_WILDCARDS, "\\$&"))
    .join("%")
}

function conditionOf(condition: VariableCondition): VariableQueryCondition {
  if (condition.operator === "like") {
    return { name: condition.name, operator: "like", value: likeOf(condition.pattern) }
  }
  return {
    name: condition.name,
    operator: OPERATORS[condition.operator],
    value:
      "at" in condition ? toEngineDate(new Date(condition.at)) : parseExact(condition.valueJson),
  }
}

/** The history's query of the instances `filter` finds; "with incident" is not the history's. */
export function historicQueryOf(filter: InstanceFilter): HistoricInstanceQuery {
  return compact({
    processDefinitionId: filter.definitionId,
    processDefinitionKey: filter.bpmnProcessId,
    processInstanceIds: filter.instanceIds,
    processInstanceBusinessKey: filter.businessKey,
    unfinished: filter.lifecycle === "running" ? (true as const) : undefined,
    finished: filter.lifecycle === "ended" ? (true as const) : undefined,
    activityIdIn: filter.activeElementId === undefined ? undefined : [filter.activeElementId],
    variables: filter.variables?.map((condition) => conditionOf(condition)),
  })
}

/** Where `filter` looks for instances with an open incident: its version, process and business key. */
export function incidentScopeOf(filter: InstanceFilter): IncidentScope {
  return compact({
    processDefinitionId: filter.definitionId,
    processDefinitionKey: filter.bpmnProcessId,
    businessKey: filter.businessKey,
  })
}

/**
 * Whether the runtime's count of instances with an open incident answers `filter` whole: running
 * instances in its scope, without given ids, an element or variable conditions.
 */
export function runtimeKnowsWhole(filter: InstanceFilter): boolean {
  return (
    filter.lifecycle !== "ended" &&
    filter.instanceIds === undefined &&
    filter.activeElementId === undefined &&
    (filter.variables?.length ?? 0) === 0
  )
}
