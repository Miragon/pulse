/**
 * Variable writes. The engine REST layer types a variable value by its
 * `type` and is strict about the wire shape:
 *
 * - `Json`, `Xml` (Spin) and `Object` are SERIALIZABLE types: the value must
 *   be the serialized STRING (or null); a JSON object/array is a 400 "Must
 *   provide 'null' or String value for value of SerializableValue type".
 * - `Object` additionally needs `valueInfo.objectTypeName` (+ the
 *   `serializationDataFormat`), or the engine finds no serializer.
 * - `Date` parses only `yyyy-MM-dd'T'HH:mm:ss.SSS±HHMM` (see `dates.ts`).
 * - JSON has no number that is not finite: it sends Infinity, -Infinity and
 *   NaN as null, so such a number is refused, whatever the type.
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

/**
 * Whether the value is, or holds at any depth (a Json or Object value given parsed), a number that
 * is not finite. A number beyond the range of a double reads as Infinity once its JSON is parsed
 * (`1e400` in a tool's arguments), and JSON would send it as null: the engine would store null
 * where a number was meant.
 */
function holdsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value)
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).some(holdsNonFiniteNumber)
}

const NOT_FINITE =
  "a number that is not finite (a number beyond the range of a double, such as 1e400, reads as " +
  "Infinity)"

/**
 * Why a value that holds a number that is not finite is refused, and what keeps its digits: a
 * variable of type String for the number itself (the text of a Double still reads as Infinity in
 * the engine), the whole value as JSON text for a value that holds one, which `serialized` passes
 * through as it is.
 */
function notFiniteRefusal(value: unknown): string {
  if (typeof value === "number") {
    return (
      `${NOT_FINITE} would go out as null; ` +
      "send it as a variable of type String with its digits as text"
    )
  }
  return (
    `the value holds ${NOT_FINITE} that would go out as null; ` +
    "send the whole value as JSON text, which keeps its digits"
  )
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
 * `RangeError` naming the variable for a value the engine would refuse, and for one that holds a
 * number that is not finite, whatever its type, which would go out as null.
 */
export function toEngineVariable(name: string, input: EngineVariableInput): EngineVariable {
  if (holdsNonFiniteNumber(input.value)) invalid(name, notFiniteRefusal(input.value))
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
 * Plain decimals: Double, else beyond the range of a double a String. Such a number is no finite
 * double (`Infinity`), which JSON would send as null: the text keeps every digit. Both checks are
 * `if`s, whose tests Stryker mutates; it leaves the test of a ternary alone.
 */
function autoDecimal(raw: string): TypedValue | undefined {
  if (!DECIMAL.test(raw)) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  return { value, type: "Double" }
}

/**
 * A variable value given as text, typed by its form: `true`/`false` → Boolean, `null` → Null,
 * integers → Integer (int32) or Long (int64, a BigInt beyond 2^53), plain decimals → Double,
 * everything else (also an integer beyond int64, a decimal beyond the range of a double,
 * `01234`, `1e3`) → String.
 */
export function autoTypedValue(raw: string): TypedValue {
  if (raw === "true" || raw === "false") return { value: raw === "true", type: "Boolean" }
  if (raw === "null") return { value: null, type: "Null" }
  const integer = INTEGER.test(raw) ? autoInteger(raw) : undefined
  if (integer !== undefined) return integer
  const decimal = autoDecimal(raw)
  if (decimal !== undefined) return decimal
  return { value: raw, type: "String" }
}
