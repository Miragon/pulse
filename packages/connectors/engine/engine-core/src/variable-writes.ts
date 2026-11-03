/**
 * Variable writes. The engine REST layer types a variable value by its
 * `type` and is strict about the wire shape:
 *
 * - `Json`, `Xml` (Spin) and `Object` are SERIALIZABLE types — the value must
 *   be the serialized STRING (or null); a JSON object/array is a 400 "Must
 *   provide 'null' or String value for value of SerializableValue type".
 * - `Object` additionally needs `valueInfo.objectTypeName` (+ the
 *   `serializationDataFormat`), or the engine finds no serializer.
 * - `Date` parses only `yyyy-MM-dd'T'HH:mm:ss.SSS±HHMM` (see `dates.ts`).
 *
 * Every variable a tool writes goes through {@link toEngineVariable}, so a
 * model (or a widget) may send a parsed JSON object, an ISO date or an Object
 * without a format and still produce the one shape the engine accepts.
 */
import { toEngineDate } from "./dates.js"
import type { TypedValue } from "./types.js"

/**
 * A variable in the engine's wire shape, the REST API's `VariableValueDto` (this package has no
 * dependency, so it states the shape; the SDK's type accepts it as is).
 */
export interface EngineVariable {
  value?: unknown
  type?: string | undefined
  valueInfo?: Record<string, unknown>
}

/** A variable as a tool receives it (value, optional type + valueInfo). */
export interface EngineVariableInput {
  value?: unknown
  type?: string | undefined
  valueInfo?: Record<string, unknown> | undefined
}

/** The serialization format an Object variable gets when none is given. */
export const DEFAULT_OBJECT_FORMAT = "application/json"

/**
 * The engine resolves a type name with its FIRST letter lowercased
 * (`Json` = `json`), so the rules below compare that form.
 */
function typeKey(type: string | undefined): string {
  return type ? type.charAt(0).toLowerCase() + type.slice(1) : ""
}

function invalid(name: string, message: string): never {
  throw new RangeError(`Variable "${name}": ${message}`)
}

function serialized(name: string, input: EngineVariableInput): unknown {
  const { value } = input
  if (value === null || value === undefined || typeof value === "string") return value
  if (typeKey(input.type) === "xml")
    invalid(name, "an Xml value must be the XML document as a string")
  return JSON.stringify(value)
}

function objectValueInfo(name: string, input: EngineVariableInput): Record<string, unknown> {
  const info = input.valueInfo ?? {}
  if (input.value !== null && input.value !== undefined) {
    const typeName = info.objectTypeName
    if (typeof typeName !== "string" || typeName.length === 0) {
      invalid(
        name,
        'an Object value needs valueInfo.objectTypeName (the Java type, e.g. "java.util.HashMap")',
      )
    }
  }
  return { serializationDataFormat: DEFAULT_OBJECT_FORMAT, ...info }
}

function dateValue(name: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== "string") invalid(name, "a Date value must be an ISO 8601 string")
  try {
    return toEngineDate(value)
  } catch (error) {
    return invalid(name, (error as Error).message)
  }
}

/**
 * One variable in the engine's wire shape (`EngineVariable`, the SDK's `VariableValueDto`). Throws a
 * `RangeError` naming the variable for a value the engine would refuse.
 */
export function toEngineVariable(name: string, input: EngineVariableInput): EngineVariable {
  const key = typeKey(input.type)
  const out: EngineVariable = { value: input.value, type: input.type }
  if (key === "json" || key === "xml" || key === "object") out.value = serialized(name, input)
  if (key === "date") out.value = dateValue(name, input.value)
  if (key === "object") out.valueInfo = objectValueInfo(name, input)
  else if (input.valueInfo) out.valueInfo = input.valueInfo
  return out
}

/** {@link toEngineVariable} over a variables map; `undefined` stays `undefined`. */
export function toEngineVariables(
  variables: Record<string, EngineVariableInput> | undefined,
): Record<string, EngineVariable> | undefined {
  if (!variables) return undefined
  return Object.fromEntries(
    Object.entries(variables).map(([name, input]) => [name, toEngineVariable(name, input)]),
  )
}

const INT32 = { min: -(2 ** 31), max: 2 ** 31 - 1 }
const INT64 = { min: -(2n ** 63n), max: 2n ** 63n - 1n }
const INTEGER = /^-?(0|[1-9]\d*)$/
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/

/** Integers: Integer (int32), else Long (exact, BigInt beyond 2^53), else beyond int64 a String. */
function autoInteger(raw: string): TypedValue | undefined {
  const value = BigInt(raw)
  if (value >= INT32.min && value <= INT32.max) return { value: Number(value), type: "Integer" }
  if (value < INT64.min || value > INT64.max) return undefined
  const exact = value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
  return { value: exact ? Number(value) : value, type: "Long" }
}

/**
 * A variable value given as text, typed by its form: `true`/`false` → Boolean, `null` → Null,
 * integers → Integer (int32) or Long (int64, a BigInt beyond 2^53), plain decimals → Double,
 * everything else (also an integer beyond int64, `01234`, `1e3`) → String.
 */
export function autoTypedValue(raw: string): TypedValue {
  if (raw === "true" || raw === "false") return { value: raw === "true", type: "Boolean" }
  if (raw === "null") return { value: null, type: "Null" }
  const integer = INTEGER.test(raw) ? autoInteger(raw) : undefined
  if (integer !== undefined) return integer
  if (DECIMAL.test(raw)) return { value: Number(raw), type: "Double" }
  return { value: raw, type: "String" }
}
