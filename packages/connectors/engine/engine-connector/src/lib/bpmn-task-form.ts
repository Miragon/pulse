// Best-effort regex parse; `readonly` fields are displayed but not submitted (the engine rejects a value).
import type { TaskFormField } from "../view-models.js"

interface ConditionLiteral {
  value: unknown
  type: "String" | "Boolean" | "Long" | "Double"
}

interface InferredCondition {
  variable: string
  literal: ConditionLiteral
}

const CAMUNDA_TYPE_MAP: Record<string, string> = {
  string: "String",
  boolean: "Boolean",
  long: "Long",
  integer: "Long",
  double: "Double",
  // Typed so a submit never rewrites a Date variable as a String.
  date: "Date",
  enum: "String",
}

export function extractEmbeddedFormFields(
  bpmnXml: string,
  taskDefinitionKey: string,
): TaskFormField[] {
  return formFieldElements(bpmnXml, taskDefinitionKey).flatMap(
    ({ attrs, inner }) => parseFormField(attrs, inner) ?? [],
  )
}

export interface FormFieldSubmitRule {
  name: string
  /** When NOT submitted, the engine writes the default over the current value (`FormFieldHandler.handleSubmit`). */
  hasDefault: boolean
  /** The legacy `<camunda:property id="readonly">` is a UI hint only; the engine accepts it. */
  engineReadonly: boolean
}

export function formFieldSubmitRules(
  bpmnXml: string,
  taskDefinitionKey: string,
): FormFieldSubmitRule[] {
  return formFieldElements(bpmnXml, taskDefinitionKey).flatMap(({ attrs, inner }) => {
    const name = readAttr(attrs, "id")
    if (!name) return []
    return [
      {
        name,
        hasDefault: readAttr(attrs, "defaultValue") !== null,
        engineReadonly: parseConstraints(inner).has("readonly"),
      },
    ]
  })
}

function formFieldElements(
  bpmnXml: string,
  taskDefinitionKey: string,
): Array<{ attrs: string; inner: string }> {
  const blockRe = new RegExp(
    `<(?:[\\w]+:)?userTask\\b[^>]*\\bid="${escapeRegex(taskDefinitionKey)}"[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?userTask>`,
    "m",
  )
  const blockMatch = bpmnXml.match(blockRe)
  if (!blockMatch) return []
  const taskBlock = blockMatch[1] ?? ""

  const formDataMatch = taskBlock.match(
    /<(?:[\w]+:)?formData\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?formData>/,
  )
  if (!formDataMatch) return []
  const formDataBlock = formDataMatch[1] ?? ""

  const fieldBlockRe = /<(?:[\w]+:)?formField\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w]+:)?formField>)/g
  return [...formDataBlock.matchAll(fieldBlockRe)].map((match) => ({
    attrs: match[1] ?? "",
    inner: match[2] ?? "",
  }))
}

function parseFormField(attrs: string, inner: string): TaskFormField | null {
  const id = readAttr(attrs, "id")
  if (!id) return null

  const label = readAttr(attrs, "label") ?? undefined
  const rawType = readAttr(attrs, "type") ?? undefined
  const type = rawType ? (CAMUNDA_TYPE_MAP[rawType.toLowerCase()] ?? rawType) : undefined

  const constraints = parseConstraints(inner)
  const readonly =
    constraints.has("readonly") ||
    /camunda:property\b[^>]*\bid="readonly"[^>]*\bvalue="true"/.test(inner)

  const suggestedValues = parseSuggestedValues(inner)

  return {
    name: id,
    label,
    type,
    required: constraints.has("required") || undefined,
    readonly: readonly || undefined,
    suggestedValues: suggestedValues.length > 0 ? suggestedValues : undefined,
    source: "form-data",
  }
}

/** Only the argument-less ones are acted on; the engine enforces every constraint on submit anyway. */
function parseConstraints(inner: string): Set<string> {
  const validation = inner.match(
    /<(?:[\w]+:)?validation\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?validation>/,
  )?.[1]
  const names = new Set<string>()
  for (const m of (validation ?? "").matchAll(/<(?:[\w]+:)?constraint\b([^>]*?)\/?>/g)) {
    const name = readAttr(m[1] ?? "", "name")
    if (name) names.add(name)
  }
  return names
}

function parseSuggestedValues(inner: string): string[] {
  const suggestedValues: string[] = []
  const valuesBlockMatch = inner.match(/<(?:[\w]+:)?values\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?values>/)
  if (!valuesBlockMatch) return suggestedValues
  const valueRe = /<(?:[\w]+:)?value\b([^>]*?)\/>/g
  for (const vm of (valuesBlockMatch[1] ?? "").matchAll(valueRe)) {
    const name = readAttr(vm[1] ?? "", "name")
    if (name) suggestedValues.push(name)
  }
  return suggestedValues
}

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`)
  const match = attrs.match(re)
  return match ? match[1] : null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Dotted identifiers are matched but dropped below: a flat task variable can't set a nested path.
const COMPARISON_RE =
  /([A-Za-z_$][\w$.]*)\s*(?:==|!=|<=?|>=?)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|-?\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|-?\d+(?:\.\d+)?)\s*(?:==|!=|<=?|>=?)\s*([A-Za-z_$][\w$.]*)/g

export function parseConditionExpression(expr: string): InferredCondition[] {
  const stripped = expr.replace(/^\s*\$\{\s*/, "").replace(/\s*\}\s*$/, "")
  const conditions: InferredCondition[] = []
  for (const match of stripped.matchAll(COMPARISON_RE)) {
    const variable = match[1] ?? match[4]
    const rawValue = match[2] ?? match[3]
    if (!variable || !rawValue) continue
    if (variable.includes(".")) continue
    const literal = parseLiteral(rawValue)
    if (literal) conditions.push({ variable, literal })
  }
  return conditions
}

function parseLiteral(raw: string): ConditionLiteral | null {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1).replace(/\\(.)/g, "$1")
    return { value: inner, type: "String" }
  }
  if (trimmed === "true" || trimmed === "false") {
    return { value: trimmed === "true", type: "Boolean" }
  }
  if (/^-?\d+$/.test(trimmed)) {
    return { value: Number(trimmed), type: "Long" }
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return { value: Number(trimmed), type: "Double" }
  }
  return null
}
