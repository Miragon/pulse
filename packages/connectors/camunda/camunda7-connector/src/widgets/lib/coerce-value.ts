/**
 * `undefined` means invalid: callers show an error, so a typo never reaches the engine
 * mistyped. Json/Object stay strings (a parsed object is a 400); dates follow `toEngineDate`.
 */

function coerceBoolean(raw: string): unknown {
  if (raw === "true") return true
  if (raw === "false") return false
  return undefined
}

function coerceWholeNumber(raw: string): unknown {
  if (!/^-?\d+$/.test(raw)) return undefined
  const num = Number(raw)
  // Beyond 2^53 `Number()` silently rounds; refuse instead of writing a corrupted value.
  return Number.isSafeInteger(num) ? num : undefined
}

function coerceDouble(raw: string): unknown {
  const num = Number(raw)
  return Number.isFinite(num) ? num : undefined
}

function coerceJson(raw: string): unknown {
  try {
    JSON.parse(raw)
    return raw
  } catch {
    return undefined
  }
}

/** A local time without offset would mean the engine's zone. */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?))?$/

function coerceDate(raw: string): unknown {
  const value = raw.trim()
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined
}

const COERCERS: Record<string, (raw: string) => unknown> = {
  Boolean: coerceBoolean,
  Long: coerceWholeNumber,
  Integer: coerceWholeNumber,
  Double: coerceDouble,
  Json: coerceJson,
  Object: coerceJson,
  Date: coerceDate,
}

export function coerceValue(raw: string, type?: string): unknown {
  if (raw === "") return ""
  if (!type) return raw
  const coerce = COERCERS[type]
  return coerce ? coerce(raw) : raw
}

/** Binary values have no text form; a Java-serialized Object is opaque bytes. */
export function isEditableVariable(variable: {
  type?: string
  valueInfo?: Record<string, unknown>
}): boolean {
  if (variable.type === "File" || variable.type === "Bytes") return false
  if (variable.type === "Object") {
    return variable.valueInfo?.serializationDataFormat === "application/json"
  }
  return true
}
