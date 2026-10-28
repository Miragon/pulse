// Fail closed: a skipped or still-quoted expression is one the label guard never checks.

/** `|`/`>` block-scalar headers, with optional chomping and indentation indicators. */
const BLOCK_SCALAR = /^[|>](?:[1-9]?[-+]?|[-+][1-9])$/

// Continuation lines join with a space: PromQL does not care about line breaks.
export function alertExpressions(yaml: string): string[] {
  const lines = yaml.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    // The key may open a list item (`- expr: …`); the dash counts as indentation.
    const match = /^(\s*(?:-\s+)?)expr:(.*)$/.exec(lines[i])
    if (!match) continue
    const [, keyIndent, rest] = match
    const line = i + 1
    // The value runs until the first non-blank line indented no deeper than the key.
    const continuation: string[] = []
    for (; i + 1 < lines.length; i++) {
      const next = lines[i + 1]
      if (next.trim() === "") continue
      if (next.length - next.trimStart().length <= keyIndent.length) break
      continuation.push(next.trim())
    }
    const inline = rest.trim()
    const value = BLOCK_SCALAR.test(inline)
      ? continuation.join(" ")
      : yamlFlowScalar([inline, ...continuation].join(" ").trim())
    if (value === "") throw new Error(`alerts.yml: empty expr at line ${line}`)
    out.push(value)
  }
  return out
}

/**
 * The string a plain or quoted YAML flow scalar denotes. Single quotes escape
 * only `''`; double quotes use backslash escapes, parsed as their JSON subset —
 * anything beyond it (or a trailing comment after the closing quote) throws.
 */
function yamlFlowScalar(text: string): string {
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) {
      throw new Error(`alerts.yml: unsupported single-quoted expr: ${text}`)
    }
    return text.slice(1, -1).replaceAll("''", "'")
  }
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text) as string
    } catch {
      throw new Error(`alerts.yml: unsupported double-quoted expr: ${text}`)
    }
  }
  return text
}

/**
 * Every panel `expr` of a Grafana dashboard, plus its templating variable
 * queries: `label_values(series, label)` becomes the equivalent
 * `count by (label)(series)`, so the label is checked like any grouping, and
 * `query_result(expr)` contributes its expression. Other `query` strings
 * (custom variable lists, `label_names()`, `metrics()`) name no label.
 */
export function dashboardQueries(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(dashboardQueries)
  if (node === null || typeof node !== "object") return []
  const out: string[] = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value !== "string") out.push(...dashboardQueries(value))
    else if (key === "expr") out.push(value)
    else if (key === "query") out.push(...templatingQuery(value))
  }
  return out
}

function templatingQuery(query: string): string[] {
  const fn = /^\s*(label_values|query_result)\s*\(/.exec(query)?.[1]
  if (!fn) return []
  const args = new RegExp(`^\\s*${fn}\\s*\\(([\\s\\S]*)\\)\\s*$`).exec(query)?.[1].trim()
  if (fn === "query_result" && args) return [args]
  // label_values(<series selector>, <label>): the label is the LAST argument —
  // the selector itself may contain commas between its matchers.
  const labelValues = args && /^([\s\S]+),\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(args)
  if (labelValues) return [`count by (${labelValues[2]})(${labelValues[1].trim()})`]
  throw new Error(`unsupported Grafana templating query (extend dashboardQueries for it): ${query}`)
}
