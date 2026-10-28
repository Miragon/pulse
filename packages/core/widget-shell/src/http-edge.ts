/**
 * DNS-rebinding protection (Origin validation is a MUST of MCP Streamable HTTP) as two allow-lists:
 * `Host` on every request (a rebinding page arrives under the ATTACKER's hostname), `Origin` on
 * non-GET/HEAD requests carrying one; requests without `Origin` pass, since non-browser MCP clients
 * never send one. App-owned instead of mcp-use's `allowedHosts`, which would also guard the
 * operational routes that probes reach by container IP.
 */

/** A loopback caller is the machine itself. */
export const LOCALHOST_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1", "[::1]"]

/**
 * 4 MiB bounds ONE request; mcp-use parses a JSON body into a heap graph up to ~20× its size before
 * the OAuth gate runs, so the in-flight budget below bounds the total.
 */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024

/** In cap-sized bodies held by requests whose response is still open; past it a request gets 503. */
export const IN_FLIGHT_BODY_MULTIPLE = 4

export const HTTP_EDGE_ENV_VARS = [
  "MCP_URL",
  "MCP_ALLOWED_HOSTS",
  "MCP_ALLOWED_ORIGINS",
  "MCP_MAX_BODY_BYTES",
  "MCP_METRICS_TOKEN",
] as const

/** `"*"` is an explicit opt-out for edges that validate themselves. */
export type AllowList = readonly string[] | "*"

export interface HttpEdgePolicy {
  allowedHosts: AllowList
  /** An entry with a scheme is an exact origin, a bare entry a hostname on any scheme/port. */
  allowedOrigins: AllowList
  maxBodyBytes: number
  maxInFlightBodyBytes: number
  /** Unset = open. */
  metricsToken?: string
}

function listFrom(raw: string | undefined): string[] | "*" {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.includes("*") ? "*" : entries
}

function hostnameOf(entry: string, variable: string): string {
  try {
    return new URL(entry.includes("://") ? entry : `http://${entry}`).hostname
  } catch {
    throw new Error(`${variable}: "${entry}" is not a hostname`)
  }
}

function originEntryOf(entry: string, variable: string): string {
  if (!entry.includes("://")) return hostnameOf(entry, variable)
  let origin: string
  try {
    origin = new URL(entry).origin
  } catch {
    origin = "null"
  }
  if (origin === "null") throw new Error(`${variable}: "${entry}" is not an origin`)
  return origin
}

function publicUrl(raw: string | undefined): URL | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`MCP_URL "${value}" is not an absolute URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP_URL "${value}" must be an http(s) URL`)
  }
  return url
}

function maxBodyBytesFrom(raw: string | undefined): number {
  const value = raw?.trim()
  if (!value) return DEFAULT_MAX_BODY_BYTES
  const bytes = Number(value)
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(`MCP_MAX_BODY_BYTES "${value}" must be a positive integer (bytes)`)
  }
  return bytes
}

function withDerived(
  list: string[] | "*",
  derived: string | undefined,
  normalize: (entry: string) => string,
): AllowList {
  if (list === "*") return "*"
  const entries = [...LOCALHOST_HOSTNAMES, ...(derived ? [derived] : []), ...list.map(normalize)]
  return [...new Set(entries)]
}

/** Invalid values fail the boot instead of silently widening (or narrowing) the edge. */
export function resolveHttpEdgePolicy(env: NodeJS.ProcessEnv = process.env): HttpEdgePolicy {
  const url = publicUrl(env.MCP_URL)
  const metricsToken = env.MCP_METRICS_TOKEN?.trim()
  const maxBodyBytes = maxBodyBytesFrom(env.MCP_MAX_BODY_BYTES)
  return {
    allowedHosts: withDerived(listFrom(env.MCP_ALLOWED_HOSTS), url?.hostname, (entry) =>
      hostnameOf(entry, "MCP_ALLOWED_HOSTS"),
    ),
    allowedOrigins: withDerived(listFrom(env.MCP_ALLOWED_ORIGINS), url?.origin, (entry) =>
      originEntryOf(entry, "MCP_ALLOWED_ORIGINS"),
    ),
    maxBodyBytes,
    maxInFlightBodyBytes: IN_FLIGHT_BODY_MULTIPLE * maxBodyBytes,
    ...(metricsToken ? { metricsToken } : {}),
  }
}

const formatBytes = (bytes: number): string => {
  const [unit, size] = bytes >= 1024 * 1024 ? ["MiB", 1024 * 1024] : ["KiB", 1024]
  if (bytes < 1024) return `${bytes} bytes`
  return `${Number((bytes / size).toFixed(2))} ${unit}`
}

/** So a 403 in the field is explainable from the log. */
export function describeHttpEdgePolicy(policy: HttpEdgePolicy): string {
  const list = (allowList: AllowList) =>
    allowList === "*" ? "any (validation off)" : allowList.join(", ")
  return (
    `HTTP edge — hosts: ${list(policy.allowedHosts)}; origins: ${list(policy.allowedOrigins)}; ` +
    `max body ${formatBytes(policy.maxBodyBytes)} (${formatBytes(policy.maxInFlightBodyBytes)} in flight); ` +
    `/metrics ${policy.metricsToken ? "token-protected" : "open"}`
  )
}

export function hostRejection(
  host: string | undefined,
  policy: HttpEdgePolicy,
): string | undefined {
  if (policy.allowedHosts === "*") return undefined
  if (!host) return "missing Host header"
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return `invalid Host header "${host}"`
  }
  if (policy.allowedHosts.includes(hostname)) return undefined
  return (
    `Host "${hostname}" is not allowed (DNS-rebinding protection). Set MCP_URL to the ` +
    `server's public URL, or add the hostname to MCP_ALLOWED_HOSTS.`
  )
}

export function originRejection(
  origin: string | undefined,
  method: string,
  policy: HttpEdgePolicy,
): string | undefined {
  if (policy.allowedOrigins === "*" || !origin) return undefined
  // Sandboxed view iframes send `Origin: null` on asset GETs (mcp-use applies the same rule).
  if (method === "GET" || method === "HEAD") return undefined
  let url: URL | undefined
  try {
    url = new URL(origin)
  } catch {
    url = undefined
  }
  const allowed =
    url !== undefined &&
    url.origin !== "null" &&
    policy.allowedOrigins.some((entry) =>
      entry.includes("://") ? entry === url.origin : entry === url.hostname,
    )
  if (allowed) return undefined
  return (
    `Origin "${origin}" is not allowed (DNS-rebinding protection). Add it to ` +
    `MCP_ALLOWED_ORIGINS if a browser app on that origin should reach this server.`
  )
}

export interface EdgeRequest {
  method: string
  /** Without the query. */
  path: string
  host: string | undefined
  origin: string | undefined
}

const isExempt = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))

/** Single-sourced so the Node listener (drops the body unread) and the hono guard never disagree. */
export function edgeRejection(
  request: EdgeRequest,
  policy: HttpEdgePolicy,
  exemptPaths: readonly string[] = [],
): string | undefined {
  if (isExempt(request.path, exemptPaths)) return undefined
  return (
    hostRejection(request.host, policy) ?? originRejection(request.origin, request.method, policy)
  )
}

/** JSON-RPC-shaped, so MCP clients surface the reason verbatim. */
export function jsonRpcErrorBody(message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null })
}

function jsonRpcErrorResponse(status: number, message: string): Response {
  return new Response(jsonRpcErrorBody(message), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}

export interface EdgeGuardContext {
  req: { method: string; path: string; header(name: string): string | undefined }
}

export interface EdgeGuardHost {
  use(
    path: "*",
    handler: (ctx: EdgeGuardContext, next: () => Promise<void>) => Promise<Response | void>,
  ): unknown
}

export interface EdgeGuardOptions {
  /** Answered regardless of `Host`/`Origin`: probes and scrapers reach them by container IP. */
  exemptPaths?: readonly string[]
}

/** Covers every route registered AFTER it (hono runs in order); mcp-use mounts `/mcp` later. */
export function installHttpEdgeGuard(
  server: EdgeGuardHost,
  policy: HttpEdgePolicy,
  { exemptPaths = [] }: EdgeGuardOptions = {},
): void {
  server.use("*", async (ctx, next) => {
    const { method, path } = ctx.req
    const rejection = edgeRejection(
      { method, path, host: ctx.req.header("host"), origin: ctx.req.header("origin") },
      policy,
      exemptPaths,
    )
    if (rejection) return jsonRpcErrorResponse(403, `Forbidden: ${rejection}`)
    await next()
  })
}
