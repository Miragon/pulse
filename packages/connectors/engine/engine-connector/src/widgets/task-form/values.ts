import type { T } from "../../messages/use-t.js"
import type { TaskFormField, TaskFormSchema } from "../../view-models.js"
import { coerceValue } from "../lib/coerce-value.js"
import type { CompleteTaskArgs } from "../lib/complete-task.js"

/** A variable the operator adds by hand, beside the form's fields. */
export interface ManualEntry {
  id: string
  name: string
  value: string
  type: string
}

type Variables = CompleteTaskArgs["variables"]

/** The variables a completion sends, or the first entry the form cannot take, worded. */
type Collected = { variables: Variables; error: null } | { error: string }

export function isRequired(field: TaskFormField): boolean {
  if (field.required === true) return true
  if (field.required === false) return false
  return false
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  return JSON.stringify(value)
}

export function initialFieldValues(schema: TaskFormSchema): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of schema.fields) {
    if (field.defaultValue !== undefined) {
      values[field.name] = stringifyValue(field.defaultValue)
    } else {
      values[field.name] = ""
    }
  }
  return values
}

/** The fields to fill in: a required one left empty, or a value its type refuses, stops the send. */
function fieldVariables(
  t: T,
  fields: readonly TaskFormField[],
  values: Record<string, string>,
): Collected {
  const variables: Variables = {}
  for (const field of fields) {
    if (field.readonly) continue
    const raw = values[field.name]
    if (raw === undefined || raw === "") {
      if (isRequired(field)) return { error: t("taskForm.errorRequired", { name: field.name }) }
      continue
    }
    const coerced = coerceValue(raw, field.type)
    if (coerced === undefined) {
      return {
        error: t("taskForm.errorInvalid", { name: field.name, type: field.type ?? "value" }),
      }
    }
    variables[field.name] = { value: coerced, type: field.type ?? "String" }
  }
  return { variables, error: null }
}

/**
 * The variables added by hand, one without a name or a value left out: a value its type refuses
 * stops the send.
 */
function manualVariables(t: T, entries: readonly ManualEntry[]): Collected {
  const variables: Variables = {}
  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name || entry.value === "") continue
    const coerced = coerceValue(entry.value, entry.type)
    if (coerced === undefined) {
      return { error: t("taskForm.errorInvalid", { name, type: entry.type }) }
    }
    variables[name] = { value: coerced, type: entry.type }
  }
  return { variables, error: null }
}

/**
 * What a completion sends: the form's fields, then the variables added by hand, which win over a
 * field of the same name; or the first entry, in that order, the form cannot take.
 */
export function collectVariables(
  t: T,
  schema: TaskFormSchema,
  values: Record<string, string>,
  entries: readonly ManualEntry[],
): Collected {
  const fields = fieldVariables(t, schema.fields, values)
  if (fields.error !== null) return fields
  const manual = manualVariables(t, entries)
  if (manual.error !== null) return manual
  return { variables: { ...fields.variables, ...manual.variables }, error: null }
}
