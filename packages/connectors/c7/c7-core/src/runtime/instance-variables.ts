/**
 * The variables of an instance's detail as the engine contract's `Variable`s: the typed ones of
 * every scope while the instance runs and the engine could list them, else those of the
 * inspection's map; each with its scope, its value as JSON text (a Json variable's own JSON) and
 * the kind its engine type names, by name (`localeCompare`, the order the editors always showed).
 * Pure.
 */

import {
  ElementId,
  type InstanceState,
  type ValueKind,
  ValueKinds,
  type Variable,
} from "@miragon/pulse-engine-core"
import { compact } from "../util.js"
import { inspectedVariablesOf, type VariableRow } from "./variable-instances.js"

/** The kind of a value by its engine type; any other type is opaque. */
const KIND_OF_TYPE: ReadonlyMap<string, ValueKind> = new Map<string, ValueKind>([
  ["String", "string"],
  ["Short", "integer"],
  ["Integer", "integer"],
  ["Long", "integer"],
  ["Double", "decimal"],
  ["Boolean", "boolean"],
  ["Date", "date"],
  ["Json", "json"],
  ["Null", "null"],
])

/** `row` as the contract's variable: a Json variable's text is the JSON it holds. */
function variableOf(row: VariableRow): Variable {
  const embedded: unknown = row.type === "Json" ? JSON.parse(row.valueJson) : undefined
  return {
    name: row.name,
    scope:
      row.scopeElementId === undefined
        ? { kind: "instance" }
        : { kind: "element", elementId: ElementId(row.scopeElementId) },
    valueJson: typeof embedded === "string" ? embedded : row.valueJson,
    truncated: false,
    kind:
      row.type === undefined
        ? ValueKinds.ofJson(row.valueJson)
        : (KIND_OF_TYPE.get(row.type) ?? "opaque"),
    ...compact({ type: row.type }),
  }
}

/**
 * The variables of an instance in `state`: `typed` while it runs and they were read, else those of
 * the inspection's `inspected` map, by name.
 */
export function variablesOf(
  state: InstanceState,
  inspected: Readonly<Record<string, unknown>> | undefined,
  typed: readonly VariableRow[] | undefined,
): Variable[] {
  const rows = state === "running" && typed !== undefined ? typed : inspectedVariablesOf(inspected)
  return rows
    .map((row) => variableOf(row))
    .sort((left, right) => left.name.localeCompare(right.name))
}
