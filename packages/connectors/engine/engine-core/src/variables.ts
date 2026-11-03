/**
 * Variables of the instance view: values fetched with `deserializeValues=false`;
 * scalar types become their plain value, every other type keeps what writing it back needs. Pure.
 */

import { isRecord } from "./util.js"
import { type Rec, records, str } from "./records.js"

/**
 * The query every variable read sends, runtime AND historic (`/history/variable-instance` takes
 * the same flag). The engine's default `deserializeValues=true` deserializes every Object
 * variable eagerly (one class missing on its classpath fails the WHOLE read with a 500) and
 * renders Json variables as Jackson's view of the Spin node instead of their JSON. With `false`,
 * Object/Json/Xml values come back as their serialized string + `valueInfo`, exactly the shape a
 * variable write takes back.
 */
export const RAW_VARIABLES = { deserializeValues: false } as const

const PLAIN_TYPES: ReadonlySet<string> = new Set([
  "string",
  "boolean",
  "integer",
  "short",
  "long",
  "double",
  "null",
])

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)
  )
}

function plainValue(typed: unknown): unknown {
  if (!isRecord(typed)) return typed
  const type = typeof typed.type === "string" ? typed.type : ""
  if (PLAIN_TYPES.has(type.toLowerCase())) return typed.value ?? null
  return {
    type,
    value: typed.value ?? null,
    ...(isEmpty(typed.valueInfo) ? {} : { valueInfo: typed.valueInfo }),
  }
}

/**
 * A variable map (`{name: {type, value, valueInfo}}`) with String, Boolean, Integer, Short, Long,
 * Double and Null values flattened (Long stays exact), others as `{type, value, valueInfo?}`;
 * sorted by name.
 */
export function plainVariables(map: unknown): Record<string, unknown> {
  if (!isRecord(map)) return {}
  const names = Object.keys(map).sort((left, right) => (left < right ? -1 : 1))
  return Object.fromEntries(names.map((name) => [name, plainValue(map[name])]))
}

/**
 * The process scope rows of historic variable instances (`activityInstanceId` equal to the
 * instance id) as a variable map.
 */
export function historicVariableMap(rows: readonly Rec[], instanceId: string): Rec {
  const scope = records(rows).filter((row) => str(row, "activityInstanceId") === instanceId)
  return Object.fromEntries(
    scope.flatMap((row) => {
      const name = str(row, "name")
      return name === undefined
        ? []
        : [[name, { type: row.type, value: row.value, valueInfo: row.valueInfo }]]
    }),
  )
}
