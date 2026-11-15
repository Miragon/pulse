/**
 * The variables of an instance as its detail reads them, each a row with its value as JSON text,
 * the engine's type and the element whose scope holds it: the runtime's typed variables of every
 * scope (`GET /variable-instance`, values the engine leaves serialized), and the variable map of
 * the inspection, the only variables of an ended instance. A value is written by `JSON.stringify`,
 * so an integer beyond 2^53 that the wire kept as raw JSON keeps its digits.
 */

import type { EnginePort } from "../port.js"
import { compact } from "../util.js"
import { RAW_VARIABLES_QUERY } from "../variables.js"
import { JsonView } from "./json-view.js"

/** A variable of an instance: its value as JSON text, the engine's type, the element it is local to. */
export interface VariableRow {
  readonly name: string
  readonly valueJson: string
  readonly type?: string
  readonly scopeElementId?: string
}

/** The typed variables read at most; a detail with as many says its variables are cut. */
export const VARIABLE_PAGE_SIZE = 500

/** The suffix of a multi-instance body's activity id, which names the activity it repeats. */
const MULTI_INSTANCE_BODY = "#multiInstanceBody"

/** The JSON text of a value; an absent one is null. */
function jsonOf(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/** The element a variable is local to; none for the process scope (the instance's own id). */
function scopeElementOf(activityInstanceId: string, processInstanceId: string): string | undefined {
  if (activityInstanceId === processInstanceId) {
    return undefined
  }
  const [elementId = activityInstanceId] = activityInstanceId.split(":")
  return elementId.replace(MULTI_INSTANCE_BODY, "")
}

/** The typed variables of every scope of `instanceId`, the first 500 the engine lists. */
export async function readVariableInstances(
  port: EnginePort,
  instanceId: string,
): Promise<VariableRow[]> {
  const answer = await port.json("getVariableInstances", {
    pathArgs: [],
    query: {
      processInstanceIdIn: instanceId,
      ...RAW_VARIABLES_QUERY,
      maxResults: String(VARIABLE_PAGE_SIZE),
    },
  })
  return JsonView.listOf(answer, "variable instances").map((record) => ({
    name: record.requiredString("name"),
    valueJson: jsonOf(record.value("value")),
    ...compact({
      type: record.optionalString("type"),
      scopeElementId: scopeElementOf(
        record.requiredString("activityInstanceId"),
        record.requiredString("processInstanceId"),
      ),
    }),
  }))
}

/** A variable of the inspection's map: a typed value (`{type, value}`) or a plain one. */
function inspectedVariableOf(name: string, value: unknown): VariableRow {
  const typed = JsonView.ifObject(value)
  const type = typed?.value("type")
  if (typed === undefined || typeof type !== "string") {
    return { name, valueJson: JSON.stringify(value) }
  }
  return {
    name,
    valueJson: jsonOf(typed.value("value")),
    ...compact({ type: type === "" ? undefined : type }),
  }
}

/** The variables of the inspection's map, in its order; none without one. */
export function inspectedVariablesOf(
  variables: Readonly<Record<string, unknown>> | undefined,
): VariableRow[] {
  return Object.entries(variables ?? {}).map(([name, value]) => inspectedVariableOf(name, value))
}
