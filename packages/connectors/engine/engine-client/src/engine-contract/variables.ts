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
import type { VariableValueDto } from "../generated/types.gen.js"
import { toEngineDate } from "./dates.js"

/** A variable as a tool receives it (value, optional type + valueInfo). */
export interface EngineVariableInput {
  value?: unknown
  type?: string
  valueInfo?: Record<string, unknown>
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
 * One variable in the engine's wire shape (`VariableValueDto`). Throws a
 * `RangeError` naming the variable for a value the engine would refuse.
 */
export function toEngineVariable(name: string, input: EngineVariableInput): VariableValueDto {
  const key = typeKey(input.type)
  const out: VariableValueDto = { value: input.value, type: input.type }
  if (key === "json" || key === "xml" || key === "object") out.value = serialized(name, input)
  if (key === "date") out.value = dateValue(name, input.value)
  if (key === "object") out.valueInfo = objectValueInfo(name, input)
  else if (input.valueInfo) out.valueInfo = input.valueInfo
  return out
}

/** {@link toEngineVariable} over a variables map; `undefined` stays `undefined`. */
export function toEngineVariables(
  variables: Record<string, EngineVariableInput> | undefined,
): Record<string, VariableValueDto> | undefined {
  if (!variables) return undefined
  return Object.fromEntries(
    Object.entries(variables).map(([name, input]) => [name, toEngineVariable(name, input)]),
  )
}
