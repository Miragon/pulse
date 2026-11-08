import { describe, expect, it } from "vitest"
import { Registry } from "prom-client"
import {
  bearerMatches,
  installMetrics,
  routeLabel,
  type HttpMiddlewareContext,
  type MetricsHost,
  type MetricsOptions,
} from "./metrics.js"

type RouteHandler = (ctx: unknown) => Response | Promise<Response>
type HttpMiddleware = (ctx: HttpMiddlewareContext, next: () => Promise<void>) => Promise<void>
type ToolMiddleware = (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>

function install(options?: MetricsOptions) {
  const routes = new Map<string, RouteHandler>()
  let http: HttpMiddleware | undefined
  let tool: ToolMiddleware | undefined
  let refuse: Parameters<MetricsHost["onRefused"]>[0] | undefined
  const server: MetricsHost = {
    get: (path, handler) => routes.set(path, handler),
    use: (pattern: "*" | "mcp:tools/call", handler: HttpMiddleware | ToolMiddleware) => {
      if (pattern === "*") http = handler as HttpMiddleware
      else tool = handler as ToolMiddleware
      return undefined
    },
    onRefused: (fn) => {
      refuse = fn
    },
  }
  const registry = installMetrics(server, { defaultMetrics: false, ...options })
  if (!http || !tool || !refuse) throw new Error("middlewares were not registered")
  const scrape = async (path = "/metrics", authorization?: string) => {
    const handler = routes.get(path)
    if (!handler) throw new Error(`no route registered for ${path}`)
    const res = await handler({
      req: { header: (name: string) => (name === "authorization" ? authorization : undefined) },
    })
    return { status: res.status, headers: res.headers, text: await res.text() }
  }
  const request = (method: string, path: string, status: number, next?: () => Promise<void>) =>
    http!({ req: { method, path }, res: { status } }, next ?? (async () => {}))
  return { routes, registry, scrape, request, tool, refuse }
}

describe("bearerMatches", () => {
  it("accepts exactly `Bearer <token>` (scheme case-insensitive)", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true)
    expect(bearerMatches("bearer   s3cret ", "s3cret")).toBe(true)
    expect(bearerMatches("Bearer s3cret2", "s3cret")).toBe(false)
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false)
    expect(bearerMatches("Basic s3cret", "s3cret")).toBe(false)
    expect(bearerMatches("s3cret", "s3cret")).toBe(false)
    expect(bearerMatches("Bearer ", "s3cret")).toBe(false)
    expect(bearerMatches(undefined, "s3cret")).toBe(false)
  })
})

describe("a request refused in front of the routes", () => {
  it("counts under route=other, whatever its target looks like", async () => {
    const { registry, refuse } = install()
    for (const target of ["/./mcp", "/x/../metrics", "//health"]) {
      refuse({ method: "GET", target, status: 404, message: "Not found" })
    }
    refuse({ method: "POST", target: "/x", status: 400, message: "Bad request" })
    const text = await registry.metrics()
    expect(text).toContain('mcp_http_requests_total{method="GET",route="other",status="404"} 3')
    expect(text).toContain('mcp_http_requests_total{method="POST",route="other",status="400"} 1')
    expect(text).toContain('mcp_http_request_duration_seconds_count{method="GET",route="other"} 3')
    expect(text).not.toMatch(/mcp\b.*\/\.\/|x\/\.\.|route="\/\//)
  })
})

describe("routeLabel", () => {
  it("keeps known routes and their sub-paths, folds everything else into other", () => {
    expect(routeLabel("/mcp")).toBe("/mcp")
    expect(routeLabel("/mcp/inspector")).toBe("/mcp")
    expect(routeLabel("/health/ready")).toBe("/health")
    expect(routeLabel("/.well-known/oauth-authorization-server")).toBe("/.well-known")
    expect(routeLabel("/metrics")).toBe("/metrics")
    expect(routeLabel("/mcpx")).toBe("other")
    expect(routeLabel("/admin/../etc/passwd")).toBe("other")
    expect(routeLabel("/")).toBe("other")
  })

  it("honors a custom route set", () => {
    expect(routeLabel("/api/v1/x", ["/api"])).toBe("/api")
    expect(routeLabel("/mcp", ["/api"])).toBe("other")
  })
})

describe("installMetrics token", () => {
  it("answers 401 with a Bearer challenge unless the scrape carries the token", async () => {
    const { scrape } = install({ token: "s3cret" })
    const anonymous = await scrape()
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get("www-authenticate")).toBe('Bearer realm="metrics"')
    expect(anonymous.text).not.toContain("mcp_tool_calls_total")
    expect((await scrape("/metrics", "Bearer wrong")).status).toBe(401)
    const authorized = await scrape("/metrics", "Bearer s3cret")
    expect(authorized.status).toBe(200)
    expect(authorized.text).toContain("mcp_tool_calls_total")
  })

  it("stays open without a token", async () => {
    const { scrape } = install()
    expect((await scrape()).status).toBe(200)
  })
})

describe("installMetrics", () => {
  it("serves the registry as Prometheus text on the scrape route", async () => {
    const { routes, scrape } = install()
    expect([...routes.keys()]).toEqual(["/metrics"])
    const res = await scrape()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/plain")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.text).toContain("# HELP mcp_tool_calls_total")
    expect(res.text).toContain("# HELP mcp_http_requests_total")
  })

  it("honors a custom scrape path, prefix and registry", async () => {
    const registry = new Registry()
    const {
      routes,
      registry: returned,
      scrape,
    } = install({
      path: "/internal/metrics",
      prefix: "acme_",
      registry,
    })
    expect(returned).toBe(registry)
    expect([...routes.keys()]).toEqual(["/internal/metrics"])
    const { text } = await scrape("/internal/metrics")
    expect(text).toContain("acme_tool_calls_total")
    expect(text).not.toContain("mcp_tool_calls_total")
  })

  it("collects the default process metrics unless disabled", async () => {
    const { scrape } = install({ defaultMetrics: true })
    expect((await scrape()).text).toContain("process_cpu_user_seconds_total")
    const { scrape: scrapeWithout } = install()
    expect((await scrapeWithout()).text).not.toContain("process_cpu_user_seconds_total")
  })

  it("counts tool calls by name and outcome and observes their duration", async () => {
    const { tool, scrape } = install()
    const ok = { content: [] }
    await expect(tool({ params: { name: "notes_list_notes" } }, async () => ok)).resolves.toBe(ok)
    await tool({ params: { name: "notes_list_notes" } }, async () => ok)
    await tool({ params: { name: "notes_show_notes" } }, async () => ({ isError: true }))
    await tool({}, async () => ok)

    const { text } = await scrape()
    expect(text).toContain('mcp_tool_calls_total{tool="notes_list_notes",outcome="ok"} 2')
    expect(text).toContain('mcp_tool_calls_total{tool="notes_show_notes",outcome="error"} 1')
    expect(text).toContain('mcp_tool_calls_total{tool="unknown",outcome="ok"} 1')
    expect(text).toContain('mcp_tool_call_duration_seconds_count{tool="notes_list_notes"} 2')
  })

  it("counts a throwing tool handler as error and rethrows", async () => {
    const { tool, scrape } = install()
    const boom = new Error("boom")
    await expect(
      tool({ params: { name: "notes_list_notes" } }, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    const { text } = await scrape()
    expect(text).toContain('mcp_tool_calls_total{tool="notes_list_notes",outcome="error"} 1')
    expect(text).toContain('mcp_tool_call_duration_seconds_count{tool="notes_list_notes"} 1')
  })

  it("counts HTTP requests by method, normalised route and status", async () => {
    const { request, scrape } = install()
    await request("GET", "/health/ready", 200)
    await request("GET", "/health/live", 200)
    await request("POST", "/mcp", 401)
    await request("GET", "/does/not/exist", 404)

    const { text } = await scrape()
    expect(text).toContain('mcp_http_requests_total{method="GET",route="/health",status="200"} 2')
    expect(text).toContain('mcp_http_requests_total{method="POST",route="/mcp",status="401"} 1')
    expect(text).toContain('mcp_http_requests_total{method="GET",route="other",status="404"} 1')
    expect(text).toContain(
      'mcp_http_request_duration_seconds_count{method="GET",route="/health"} 2',
    )
    expect(text).not.toContain("/does/not/exist")
  })

  it("records 500 for an error escaping hono's error handler and rethrows", async () => {
    const { request, scrape } = install()
    const boom = new Error("boom")
    await expect(
      request("POST", "/mcp", 200, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    const { text } = await scrape()
    expect(text).toContain('mcp_http_requests_total{method="POST",route="/mcp",status="500"} 1')
  })
})
