/**
 * The routes of the Camunda 7 REST API family: each operation's method, path template and effect,
 * generated from the one spec (spec/api.json, by scripts/generate-routes.ts), and the two rules a
 * surface reads them by: which route a request is (`routeOf`) and whether it only reads
 * (`intentOf`), so no surface keeps a list of its own of the POSTs that only read.
 */

/** What an operation does to engine state: a read, a write, a delete or one that touches many. */
export type Effect = "read" | "write" | "delete" | "bulk"

/** The methods of the REST API. */
export type RouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS"

/** One operation of the REST API. */
export interface Route {
  readonly operationId: string
  readonly method: RouteMethod
  /** Its path template below the REST root, such as `/process-instance/{id}`. */
  readonly path: string
  readonly effect: Effect
  /** Whether the path also answers below `/engine/{name}`, the REST API of a named engine. */
  readonly engineScoped: boolean
  /** The media types of its success answers, in the spec's order: what to `Accept`. */
  readonly accepts: readonly string[]
}

/** Routes by operation id. */
export type Routes = Readonly<Record<string, Route>>

/** Whether a request only reads or may change engine state. */
export type RouteIntent = "read" | "write"

/** The methods that only read where no route says otherwise. */
const READING_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"])

/** The rank of a segment that a template does not match. */
const NO_MATCH = -1

/** The segments of a path below the root: `/a/b` gives `a`, `b`. */
function segmentsOf(path: string): readonly string[] {
  return path.split("/").slice(1)
}

/** Whether a segment of a path template is a placeholder: a name in braces, `{id}`. */
export function isPlaceholder(part: string): boolean {
  return part.startsWith("{") && part.endsWith("}")
}

/**
 * How a template segment matches a request segment: 0 for a literal that equals it, 1 for a
 * placeholder, which takes any value but an empty one, else NO_MATCH.
 */
function rankOf(part: string, segment: string | undefined): number {
  if (isPlaceholder(part)) return segment ? 1 : NO_MATCH
  return part === segment ? 0 : NO_MATCH
}

/** The rank of each segment, or undefined when the template does not match the segments. */
function ranksOf(template: readonly string[], segments: readonly string[]): number[] | undefined {
  if (template.length !== segments.length) return undefined
  const ranks = template.map((part, index) => rankOf(part, segments[index]))
  return ranks.includes(NO_MATCH) ? undefined : ranks
}

/** Whether ranks `a` beat ranks `b`: the first segment where they differ is a literal in `a`. */
function precedes(a: readonly number[], b: readonly number[]): boolean {
  for (const [at, rank] of a.entries()) {
    if (rank !== b[at]) return rank === 0
  }
  return false
}

/** The best match among `routes` for the segments; `scoped` admits engine-scoped routes only. */
function bestMatch(
  routes: readonly Route[],
  segments: readonly string[],
  scoped: boolean,
): Route | undefined {
  let best: { readonly route: Route; readonly ranks: readonly number[] } | undefined
  for (const route of routes) {
    if (scoped && !route.engineScoped) continue
    const ranks = ranksOf(segmentsOf(route.path), segments)
    if (ranks !== undefined && (best === undefined || precedes(ranks, best.ranks))) {
      best = { route, ranks }
    }
  }
  return best?.route
}

/**
 * The route of a request: `method` and `path` below the REST root, without the query, a named
 * engine's `/engine/{name}` before it included. A literal segment wins over a placeholder, from
 * the left: `GET /process-instance/count` is `getProcessInstancesCount`, not `getProcessInstance`.
 * Undefined for a request the table does not know.
 */
export function routeOf(routes: Routes, method: string, path: string): Route | undefined {
  if (!path.startsWith("/")) return undefined
  const candidates = Object.values(routes).filter((route) => route.method === method.toUpperCase())
  const segments = segmentsOf(path)
  const direct = bestMatch(candidates, segments, false)
  if (direct !== undefined || segments[0] !== "engine" || segments[1] === "") return direct
  return bestMatch(candidates, segments.slice(2), true)
}

/**
 * Whether a request only reads: by its route's effect, so a POST that queries or evaluates reads
 * and a GET never writes. A request no route knows reads only as a GET or a HEAD, so an unknown
 * POST counts as a write (fail closed).
 */
export function intentOf(route: Route | undefined, method: string): RouteIntent {
  if (route === undefined) return READING_METHODS.has(method.toUpperCase()) ? "read" : "write"
  return route.effect === "read" ? "read" : "write"
}
