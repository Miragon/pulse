/**
 * The one line a failed boot prints (`runComposedServer`): the server's name, what happened and
 * the error's own sentence, with no stack unless the error is a bug (`bootErrorFrames`). The boot
 * names the server on the errors it lets through without wrapping them, so `createComposedServer`
 * and `listen()` still reject with the very error a test asserts on.
 */
const bootLabels = new WeakMap<object, string>()

/** Records which server's boot `error` failed; the first label wins. Returns `error` to rethrow. */
export function labelBootError(error: unknown, label: string): unknown {
  if (typeof error === "object" && error !== null && !bootLabels.has(error)) {
    bootLabels.set(error, label)
  }
  return error
}

interface IssueLike {
  path: readonly PropertyKey[]
  message: string
}

/** A ZodError of any zod instance (a module may bundle its own): its message is the issues as JSON. */
function zodIssues(error: unknown): readonly IssueLike[] | undefined {
  if (!(error instanceof Error) || error.name !== "ZodError") return undefined
  const issues = (error as { issues?: unknown }).issues
  return Array.isArray(issues) ? (issues as IssueLike[]) : undefined
}

/** `["engines", 0, "id"]` → `engines[0].id`. */
function pathText(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : `${i === 0 ? "" : "."}${String(key)}`))
    .join("")
}

function messageOf(error: unknown): string {
  const issues = zodIssues(error)
  if (issues) {
    return issues
      .map(({ path, message }) => (path.length > 0 ? `${pathText(path)}: ${message}` : message))
      .join("; ")
  }
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/** JavaScript's own types for a bug, not a setting: where it happened is what a reader needs. */
const BUG_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError"])

/**
 * The stack frames a bug prints below the line (a TypeError in a module's `createPlugin`, say);
 * none for every other error. A SyntaxError is left out: at boot it is a setting that JSON.parse or
 * a RegExp refused, and its frames would only bury that.
 */
export function bootErrorFrames(error: unknown): string[] {
  if (!(error instanceof Error) || !BUG_ERRORS.has(error.name) || !error.stack) return []
  return error.stack.split("\n").filter((line) => /^\s+at /.test(line))
}

/** `[label] The server did not start: <the error's sentence>`, on one line. */
export function bootErrorLine(error: unknown): string {
  const label = typeof error === "object" && error !== null ? bootLabels.get(error) : undefined
  const prefix = label === undefined ? "" : `[${label}] `
  let message = messageOf(error)
    .replace(/\s*\n\s*/g, " ")
    .trim()
  // Most boot errors already open with the server's name.
  if (prefix && message.startsWith(prefix)) message = message.slice(prefix.length)
  return `${prefix}The server did not start: ${message}`
}
