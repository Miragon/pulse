/**
 * Labels stay bounded: tool names are a finite catalogue, routes fold onto known ones (paths are
 * caller-controlled); never arguments, users or sessions. Calls refused by the SDK before the handler
 * show only in mcp-use's request log. Default collectors keep their standard unprefixed names for
 * stock Grafana dashboards. Outside the OAuth gate: set `token` or front it with network policy.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client"
import type { HttpRouteHost } from "./health.js"
import { toolCallOutcome, toolNameOf, type ToolCallMiddlewareHost } from "./host-boot.js"

export interface HttpMiddlewareContext {
  req: { method: string; path: string }
  res: { status: number }
}

export interface HttpMiddlewareHost {
  use(
    path: "*",
    handler: (ctx: HttpMiddlewareContext, next: () => Promise<void>) => Promise<void>,
  ): unknown
}

export type MetricsHost = HttpRouteHost & HttpMiddlewareHost & ToolCallMiddlewareHost

export interface MetricsOptions {
  path?: string
  prefix?: string
  defaultMetrics?: boolean
  routes?: readonly string[]
  /** Default: a fresh one, never the global registry, so hosts and tests stay isolated. */
  registry?: Registry
  /** Unset = open. */
  token?: string
}

const DEFAULT_ROUTES: readonly string[] = ["/mcp", "/health", "/metrics", "/.well-known", "/fonts"]
const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]

const digest = (value: string): Buffer => createHash("sha256").update(value).digest()

/** Hashing equalizes the lengths for a constant-time compare. */
export function bearerMatches(authorization: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "")
  return match !== null && timingSafeEqual(digest(match[1]), digest(token))
}

const authorizationOf = (ctx: unknown): string | undefined =>
  (ctx as { req?: { header?(name: string): string | undefined } } | undefined)?.req?.header?.(
    "authorization",
  )

export function routeLabel(path: string, routes: readonly string[] = DEFAULT_ROUTES): string {
  return routes.find((route) => path === route || path.startsWith(`${route}/`)) ?? "other"
}

/** Call BEFORE registering routes to count: hono stops at the first response in registration order. */
export function installMetrics(server: MetricsHost, options: MetricsOptions = {}): Registry {
  const {
    path = "/metrics",
    prefix = "mcp_",
    defaultMetrics = true,
    routes = DEFAULT_ROUTES,
    registry = new Registry(),
    token,
  } = options
  if (defaultMetrics) collectDefaultMetrics({ register: registry })

  const toolCalls = new Counter({
    name: `${prefix}tool_calls_total`,
    help: "MCP tools/call invocations by tool and outcome (ok | error).",
    labelNames: ["tool", "outcome"],
    registers: [registry],
  })
  const toolDuration = new Histogram({
    name: `${prefix}tool_call_duration_seconds`,
    help: "MCP tools/call handler duration in seconds.",
    labelNames: ["tool"],
    buckets: DURATION_BUCKETS,
    registers: [registry],
  })
  const httpRequests = new Counter({
    name: `${prefix}http_requests_total`,
    help: "HTTP requests by method, route and status code.",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  })
  const httpDuration = new Histogram({
    name: `${prefix}http_request_duration_seconds`,
    help: "HTTP request duration in seconds by method and route.",
    labelNames: ["method", "route"],
    buckets: DURATION_BUCKETS,
    registers: [registry],
  })

  server.use("mcp:tools/call", async (ctx, next) => {
    const tool = toolNameOf(ctx)
    const stop = toolDuration.startTimer({ tool })
    // A throwing handler never reaches the assignment below.
    let outcome = "error"
    try {
      const result = await next()
      outcome = toolCallOutcome(result)
      return result
    } finally {
      stop()
      toolCalls.inc({ tool, outcome })
    }
  })

  server.use("*", async (ctx, next) => {
    const method = ctx.req.method
    const route = routeLabel(ctx.req.path, routes)
    const stop = httpDuration.startTimer({ method, route })
    // hono routes handler errors to c.res = 500; the fallback covers an error escaping `next()`.
    let status = "500"
    try {
      await next()
      status = String(ctx.res.status)
    } finally {
      stop()
      httpRequests.inc({ method, route, status })
    }
  })

  server.get(path, async (ctx) => {
    if (token !== undefined && !bearerMatches(authorizationOf(ctx), token)) {
      return new Response("Unauthorized\n", {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="metrics"', "cache-control": "no-store" },
      })
    }
    return new Response(await registry.metrics(), {
      headers: { "content-type": registry.contentType, "cache-control": "no-store" },
    })
  })

  return registry
}
