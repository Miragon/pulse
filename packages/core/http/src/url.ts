/**
 * URLs below an API root. A request goes only to the root it was configured for, so the
 * credential never reaches another origin, and never to a path the URL parser would rewrite:
 * `.` and `..` are resolved away (`/process-instance/.` reads the list) and an empty segment
 * (`//`) names another resource or none.
 */

/** Why a path value cannot be sent. */
export type PathValueProblem = "empty" | "dot-segment"

/** The path value rule: `""`, `"."` and `".."` are refused before sending, any other value is encoded. */
export function pathValueProblem(value: string): PathValueProblem | undefined {
  if (value === "") return "empty"
  return value === "." || value === ".." ? "dot-segment" : undefined
}

/** A path value the rule refuses; the message names the problem, never the value. */
export class PathValueError extends Error {
  override readonly name = "PathValueError"

  constructor(readonly problem: PathValueProblem) {
    super(`path value refused: ${problem}`)
  }
}

/** One path segment from a value: percent-encoded, or a {@link PathValueError}. */
export function encodePathValue(value: string): string {
  const problem = pathValueProblem(value)
  if (problem !== undefined) throw new PathValueError(problem)
  return encodeURIComponent(value)
}

/** `value` without its trailing slashes, in linear time. */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") end -= 1
  return value.slice(0, end)
}

/**
 * The API root of a connection URL: an absolute http or https URL without credentials, query or
 * fragment, normalized, its trailing slashes trimmed. Throws a RangeError that names no part of
 * the URL (it may carry a password).
 */
export function rootOf(url: string): string {
  if (!URL.canParse(url)) throw new RangeError("the connection URL is no absolute URL")
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RangeError("the connection URL must use http or https")
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new RangeError("the connection URL carries credentials: hand them over as its credential")
  }
  if (/[?#]/.test(parsed.href))
    throw new RangeError("the connection URL carries a query or fragment")
  return withoutTrailingSlashes(parsed.href)
}

export type QueryValue = string | number | boolean
export type Query = Readonly<Record<string, QueryValue | readonly QueryValue[] | undefined>>

function searchOf(query: Query | URLSearchParams | undefined): string {
  if (query === undefined || query instanceof URLSearchParams) return query?.toString() ?? ""
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue
    const values: readonly QueryValue[] = Array.isArray(value) ? value : [value as QueryValue]
    for (const one of values) params.append(name, String(one))
  }
  return params.toString()
}

/**
 * A request URL: the root, the path as given (its values encoded by the caller, nothing
 * normalized, so the transport sees what would be sent) and the query, if any.
 */
export function joinUrl(root: string, path: string, query?: Query | URLSearchParams): string {
  const below = path === "" || path.startsWith("/") ? path : `/${path}`
  const search = searchOf(query)
  return `${withoutTrailingSlashes(root)}${below}${search === "" ? "" : `?${search}`}`
}

/** Why a request URL cannot be sent below a root. */
export type RequestUrlProblem =
  "not-a-url" | "credentials" | "outside-root" | "dot-segment" | "empty-segment"

const ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^/\\?#]*/i

/** The path of `url` as written, before the parser resolves anything (it drops tabs and line breaks). */
function writtenPath(url: string): string {
  return url
    .replace(/[\t\n\r]/g, "")
    .replace(ORIGIN, "")
    .replace(/[?#].*$/s, "")
}

function isDotSegment(segment: string): boolean {
  const dots = segment.toLowerCase().replaceAll("%2e", ".")
  return dots === "." || dots === ".."
}

/**
 * Whether `url` may be sent below `root` (an output of {@link rootOf}), or why not. A user or a
 * password in it is refused: fetch would throw on it with the whole URL in its message, and the
 * credential belongs to the connection.
 */
export function requestUrlProblem(url: string, root: string): RequestUrlProblem | undefined {
  if (!URL.canParse(url)) return "not-a-url"
  const parsed = new URL(url)
  if (parsed.username !== "" || parsed.password !== "") return "credentials"
  const base = new URL(root)
  if (parsed.origin !== base.origin) return "outside-root"
  if (writtenPath(url).split(/[/\\]/).some(isDotSegment)) return "dot-segment"
  return pathProblem(parsed.pathname, withoutTrailingSlashes(base.pathname))
}

/** Whether a parsed path lies below the root's path, without an empty segment, or why not. */
function pathProblem(path: string, rootPath: string): RequestUrlProblem | undefined {
  if (path !== rootPath && !path.startsWith(`${rootPath}/`)) return "outside-root"
  // A root without a path is the origin, whose own path the parser writes as "/".
  const below = rootPath === "" && path === "/" ? "" : path.slice(rootPath.length)
  return below !== "" && below.slice(1).split("/").includes("") ? "empty-segment" : undefined
}

/** Where a request went, for a message: origin and path, never the query or a credential. */
export function targetOf(url: string): string {
  if (!URL.canParse(url)) return ""
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`
}
