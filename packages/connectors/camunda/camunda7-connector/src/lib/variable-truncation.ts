// Variable values can be megabytes; model-facing reads cut them with an explicit marker.
// Widget feeds read uncut: an in-place edit writes the shown value back whole.
export const MAX_VARIABLE_VALUE_CHARS = 2000

export const VARIABLE_TRUNCATION_NOTE = `String values over ${MAX_VARIABLE_VALUE_CHARS} chars are cut (truncated: true, valueLength = full size).`

/** A cut value written back would overwrite the stored value with its prefix. */
export const CUT_VALUE_WRITE_RULE =
  "Never write back a value read with truncated: true — it is incomplete; read it whole first (variableName)."

export interface TruncationMarker {
  truncated: true
  valueLength: number
}

export function truncateVariable<T extends { value?: unknown }>(
  variable: T,
): T | (T & TruncationMarker) {
  const { value } = variable
  if (typeof value !== "string" || value.length <= MAX_VARIABLE_VALUE_CHARS) return variable
  return {
    ...variable,
    value: value.slice(0, MAX_VARIABLE_VALUE_CHARS),
    truncated: true,
    valueLength: value.length,
  }
}

export function truncateVariableMap<T extends { value?: unknown }>(
  variables: Record<string, T>,
): Record<string, T | (T & TruncationMarker)> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, variable]) => [name, truncateVariable(variable)]),
  )
}

export function truncateVariableRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows
  return rows.map((row: unknown) =>
    typeof row === "object" && row !== null ? truncateVariable(row as { value?: unknown }) : row,
  )
}

/** An unknown name fails rather than returning an empty map that looks like "no such data". */
export function variableRead<T extends { value?: unknown }>(
  variables: Record<string, T>,
  variableName?: string,
): Record<string, T | (T & TruncationMarker)> {
  if (variableName === undefined) return truncateVariableMap(variables)
  if (!Object.hasOwn(variables, variableName)) {
    throw new Error(`No variable named "${variableName}" — omit variableName to list them all.`)
  }
  return { [variableName]: variables[variableName] }
}
