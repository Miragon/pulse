// Variable values can be megabytes; model-facing reads cut them with an explicit marker.
// Widget feeds read uncut: an in-place edit writes the shown value back whole.
export const MAX_VARIABLE_VALUE_CHARS = 2000

/** A cut value written back would overwrite the stored value with its prefix. */
export const CUT_VALUE_WRITE_RULE =
  "Never write back a value read with truncated: true. It is incomplete; read it whole first (variableName)."

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

/**
 * A plain variable map (engine-core's view: scalars flattened, other types `{ type, value, … }`)
 * cut like the other reads: a string over the limit becomes `{ value, truncated, valueLength }`.
 */
export function truncatePlainVariables(
  variables: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => {
      if (typeof value === "string") {
        const plain = { value }
        const cut = truncateVariable(plain)
        return [name, cut === plain ? value : cut]
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return [name, truncateVariable(value as { value?: unknown })]
      }
      return [name, value]
    }),
  )
}

/** An unknown name fails rather than returning an empty map that looks like "no such data". */
export function variableRead<T extends { value?: unknown }>(
  variables: Record<string, T>,
  variableName?: string,
): Record<string, T | (T & TruncationMarker)> {
  if (variableName === undefined) return truncateVariableMap(variables)
  if (!Object.hasOwn(variables, variableName)) {
    throw new Error(`No variable named "${variableName}"; omit variableName to list them all.`)
  }
  return { [variableName]: variables[variableName] }
}
