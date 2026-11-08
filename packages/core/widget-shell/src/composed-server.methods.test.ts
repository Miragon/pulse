import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import {
  all,
  moduleOf,
  plain,
  POST_INITIALIZE,
  rawRequest,
  ROUTES,
  scrape,
  statuses,
  stubOAuth,
} from "./composed-server.test-support.js"
import { METHOD_REFUSED } from "./http-edge.js"

/**
 * A method the SDK's bridge cannot build a `Request` of: the real listener, on real sockets, since
 * `new Request` refuses these methods before a test through `app.fetch` could send one.
 */

let log: MockInstance<(line: string) => void>
let failed: MockInstance<(...data: unknown[]) => void>
const running: RunningServer[] = []

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  log = vi.spyOn(console, "log").mockImplementation(() => {})
  failed = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.restoreAllMocks()
})

const probeModule = moduleOf({
  name: "probe",
  register: (server) => plain(server, "probe_tool"),
})

async function boot(overrides: Partial<ComposedServerOptions> = {}) {
  const composed = await createComposedServer({
    info: { name: "methods-test", version: "0.0.0" },
    modules: [probeModule],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  })
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return { server, port: server.port }
}

const TRACE = { method: "TRACE" } as const

const allowOf = (head: string) => /^allow: *(.*)$/im.exec(head)?.[1]

const loggedLines = () => log.mock.calls.map(([line]) => String(line))

// `new Request` throws on TRACE: the SDK's bridge would answer 500 and put a stack in the log, for
// anyone, on every path. The Allow is the route's: a boot under OAuth has every route there is.
describe("the listener: a method no Request can carry", () => {
  it.each(ROUTES)("refuses TRACE $route with 405 and $allow", async ({ route, allow }) => {
    const { port } = await boot({ oauth: stubOAuth() })
    const request = { ...TRACE, target: route, connection: "keep-alive" as const }
    const { status, head, body } = await rawRequest(port, request)
    expect(status).toBe(405)
    expect(allowOf(head)).toBe(allow)
    expect(head).toMatch(/^connection: close$/im)
    expect(head).toMatch(/^cache-control: no-store$/im)
    expect(JSON.parse(body)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: METHOD_REFUSED },
      id: null,
    })
    expect(loggedLines()).toEqual([`TRACE ${route} 405 0ms ERROR ${METHOD_REFUSED}`])
    expect(failed).not.toHaveBeenCalled()
  })

  it.each(ROUTES)("$route answers every method its Allow names", async (entry) => {
    const { port } = await boot({ oauth: stubOAuth() })
    for (const method of entry.allow.split(", ")) {
      const request = { ...entry.request, method, target: entry.route }
      const { status } = await rawRequest(port, request)
      expect([404, 405], method).not.toContain(status)
    }
  })

  it("names what the SDK's own 405 names on /mcp and on discovery", async () => {
    const open = await boot()
    const underOAuth = await boot({ oauth: stubOAuth() })
    const routes = [
      { port: open.port, target: "/mcp" },
      { port: underOAuth.port, target: "/.well-known/oauth-protected-resource/mcp" },
    ]
    for (const { port, target } of routes) {
      const put = { method: "PUT", target, body: { length: 0, sent: "" } }
      const own = await rawRequest(port, put)
      expect(own.status).toBe(405)
      const { head } = await rawRequest(port, { ...TRACE, target })
      expect(allowOf(head)).toBe(allowOf(own.head))
    }
  })

  it.each(["/", "/x", "/mcp/x", "/MCP", "/health/x", "/metrics/x", "/fonts/x", "/.well-known/x"])(
    "answers 405 on %s too, where no route takes anything",
    async (target) => {
      const { port } = await boot({ oauth: stubOAuth() })
      const { status, head } = await rawRequest(port, { ...TRACE, target })
      expect(status).toBe(405)
      expect(allowOf(head)).toBe("")
      expect((await rawRequest(port, { target })).status).toBe(404)
      expect(failed).not.toHaveBeenCalled()
    },
  )

  it("names no discovery method where no OAuth serves discovery", async () => {
    const { port } = await boot()
    const target = "/.well-known/oauth-protected-resource/mcp"
    const { status, head } = await rawRequest(port, { ...TRACE, target })
    expect(status).toBe(405)
    expect(allowOf(head)).toBe("")
    expect((await rawRequest(port, { target })).status).toBe(404)
  })

  it("comes before the Host and the Origin check", async () => {
    const { port } = await boot()
    const host = "attacker.example"
    expect((await rawRequest(port, { ...TRACE, target: "/mcp", host })).status).toBe(405)
    expect((await rawRequest(port, { target: "/mcp", host })).status).toBe(403)
    const headers = { ...POST_INITIALIZE.headers, Origin: "https://attacker.example" }
    expect((await rawRequest(port, { ...TRACE, target: "/mcp", headers })).status).toBe(405)
    const posted = { ...POST_INITIALIZE, target: "/mcp", headers }
    expect((await rawRequest(port, posted)).status).toBe(403)
  })

  it("comes before the metrics token", async () => {
    const { port } = await boot({ env: { MCP_METRICS_TOKEN: "s3cret" } })
    expect((await rawRequest(port, { ...TRACE, target: "/metrics" })).status).toBe(405)
    expect((await rawRequest(port, { target: "/metrics" })).status).toBe(401)
  })

  it("comes before the body, and leaves a drain nothing to wait for", async () => {
    const { server, port } = await boot({ env: { MCP_MAX_BODY_BYTES: "64" } })
    const upload = { body: { length: 5000, sent: "x".repeat(10) }, target: "/mcp" }
    expect((await rawRequest(port, { ...upload, method: "POST" })).status).toBe(413)
    expect((await rawRequest(port, { ...upload, ...TRACE })).status).toBe(405)
    const started = Date.now()
    await server.shutdown()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("comes after the path and the Host, which refuse any method", async () => {
    const { port } = await boot()
    expect((await rawRequest(port, { ...TRACE, target: "/./mcp" })).status).toBe(404)
    expect((await rawRequest(port, { ...TRACE, target: "*" })).status).toBe(404)
    expect((await rawRequest(port, { ...TRACE, target: "/x", host: "h/mcp?" })).status).toBe(400)
    expect(failed).not.toHaveBeenCalled()
  })

  it("logs no query, which can carry a token", async () => {
    const { port } = await boot()
    await rawRequest(port, { ...TRACE, target: "/mcp?access_token=s3cret" })
    const lines = loggedLines()
    expect(lines).toEqual([expect.stringMatching(/^TRACE \/mcp 405 0ms ERROR Method not allowed/)])
    expect(lines[0]).not.toContain("s3cret")
  })

  it("counts it under route=other, and no path becomes a label", async () => {
    const { port } = await boot({ oauth: stubOAuth() })
    const targets = [...ROUTES.map(({ route }) => route), "/x", "/mcp/x?y=1"]
    expect(await statuses(port, targets, TRACE)).toEqual(all(targets, 405))
    const metrics = await scrape(port)
    expect(metrics).toContain(
      `mcp_http_requests_total{method="TRACE",route="other",status="405"} ${targets.length}`,
    )
    const labels = [...metrics.matchAll(/\broute="([^"]*)"/g)].map(([, route]) => route)
    expect(new Set(labels)).toEqual(new Set(["other"]))
    expect(metrics).toMatch(
      /^mcp_http_request_duration_seconds_count\{method="TRACE",route="other"\} /m,
    )
  })

  // These never reach the listener, so no request of them can fill the log. A Node that lets one
  // through fails here, for a reader to check that the refusal above answers it.
  it.each(["TRACK", "track", "trace"])(
    "lets Node's parser refuse %s: 400, with nothing in the log or a counter",
    async (method) => {
      const { port } = await boot()
      expect((await rawRequest(port, { method, target: "/mcp" })).status).toBe(400)
      expect(log).not.toHaveBeenCalled()
      expect(failed).not.toHaveBeenCalled()
      expect(await scrape(port)).not.toContain(`method="${method}"`)
    },
  )

  it.each(["example.com:443", "/mcp"])(
    "lets Node close a CONNECT %s unanswered, with nothing in the log or a counter",
    async (target) => {
      const { port } = await boot()
      await expect(rawRequest(port, { method: "CONNECT", target })).rejects.toThrow(
        "the socket closed without an answer",
      )
      expect(log).not.toHaveBeenCalled()
      expect(failed).not.toHaveBeenCalled()
      expect(await scrape(port)).not.toContain('method="CONNECT"')
    },
  )
})
