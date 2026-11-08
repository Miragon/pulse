import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { moduleOf, plain, rawRequest, type RawRequest } from "./composed-server.test-support.js"
import { oauthCustomProvider } from "./oauth-providers.js"
import { SERVED_FONT_FILES, SERVED_FONT_PATH } from "./protocol/served-fonts.js"

/**
 * A route answers under its own path only: the real listener, on real sockets, because a `Request`
 * has its dot segments resolved before the app can see them. Under OAuth a reached `/mcp` answers
 * 401, so a 404 also says the refusal came first.
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

const stubOAuth = () =>
  oauthCustomProvider({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer: "https://idp.example.test",
      authorization_endpoint: "https://idp.example.test/a",
      token_endpoint: "https://idp.example.test/t",
      response_types_supported: ["code"],
    },
    createTokenVerifier: () => ({
      verifyAccessToken: () => Promise.reject(new Error("no token is known")),
    }),
    mapAuthInfo: () => ({ user: { id: "u" }, payload: { sub: "u" }, permissions: [] }),
  })

const probeModule = moduleOf({
  name: "probe",
  register: (server) => plain(server, "probe_tool"),
})

const compose = (overrides: Partial<ComposedServerOptions> = {}) =>
  createComposedServer({
    info: { name: "paths-test", version: "0.0.0" },
    modules: [probeModule],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  })

async function boot(overrides: Partial<ComposedServerOptions> = {}) {
  const composed = await compose(overrides)
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return { composed, server, port: server.port }
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "unit", version: "0" },
  },
})

const POST_INITIALIZE: Partial<RawRequest> = {
  method: "POST",
  body: { length: Buffer.byteLength(INITIALIZE), sent: INITIALIZE },
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
}

const FONT = `${SERVED_FONT_PATH}/${SERVED_FONT_FILES.sans}`

/** Every route, with what it answers under its own name on a boot under OAuth. */
const ROUTES: { route: string; reached: number; request?: Partial<RawRequest> }[] = [
  { route: "/mcp", reached: 401, request: POST_INITIALIZE },
  { route: "/health", reached: 200 },
  { route: "/health/live", reached: 200 },
  { route: "/health/ready", reached: 200 },
  { route: "/metrics", reached: 200 },
  { route: "/.well-known/oauth-protected-resource/mcp", reached: 200 },
  { route: FONT, reached: 200 },
]

/** What a URL parser folds onto the route, and the shapes a route must not answer to either. */
const notNormal = (route: string, port: number) => [
  `/.${route}`,
  `/..${route}`,
  `/x/..${route}`,
  `/%2e${route}`,
  `/%2E${route}`,
  `/%2e%2e${route}`,
  `/%2E%2E${route}`,
  `/.%2e${route}`,
  `/%2e.${route}`,
  `/x/%2e%2e${route}`,
  `/${route}`,
  `${route}/`,
  `${route}/.`,
  `${route}/..`,
  `${route}/x/..`,
  `${route}/%2e`,
  `/\\${route.slice(1)}`,
  `${route}\\`,
  `${route}#f`,
  `http://127.0.0.1:${port}${route}`,
  `HTTP://127.0.0.1:${port}${route}`,
  `http://127.0.0.1:${port}/.${route}`,
  `http://127.0.0.1:${port}${route}?x=1`,
]

/** Inside a route of more than one segment. */
const inside = (route: string) => {
  const slash = route.lastIndexOf("/")
  if (slash === 0) return []
  const [head, tail] = [route.slice(0, slash), route.slice(slash + 1)]
  return [`${head}/./${tail}`, `${head}/x/../${tail}`, `${head}/%2e/${tail}`, `${head}//${tail}`]
}

/** Normal, and no route's name: the router's 404. */
const noRoute = (route: string) => [
  route.toUpperCase(),
  `${route};x=1`,
  `${route}%2f`,
  `${route}%2e`,
  `/%5c${route.slice(1)}`,
]

/** One after the other: a burst of sockets overflows a small listen backlog (macOS: 128). */
async function statuses(
  port: number,
  targets: readonly string[],
  request: Partial<RawRequest> = {},
) {
  const answers: Record<string, number> = {}
  for (const target of targets) {
    answers[target] = (await rawRequest(port, { ...request, target })).status
  }
  return answers
}

const all = (targets: readonly string[], status: number) =>
  Object.fromEntries(targets.map((target) => [target, status]))

const scrape = async (port: number) => (await rawRequest(port, { target: "/metrics" })).body

describe("the listener: a route answers under its own path only", () => {
  it.each(ROUTES)("$route answers under its name", async ({ route, reached, request }) => {
    const { port } = await boot({ oauth: stubOAuth() })
    expect((await rawRequest(port, { ...request, target: route })).status).toBe(reached)
  })

  it.each(ROUTES)("$route answers no alias of it", async ({ route, request }) => {
    const { port } = await boot({ oauth: stubOAuth() })
    const targets = [...notNormal(route, port), ...inside(route)]
    expect(await statuses(port, targets, request)).toEqual(all(targets, 404))
    expect(failed).not.toHaveBeenCalled()
  })

  it.each(ROUTES)(
    "$route stays no match of a spelling it never had",
    async ({ route, request }) => {
      const { port } = await boot({ oauth: stubOAuth() })
      expect(await statuses(port, noRoute(route), request)).toEqual(all(noRoute(route), 404))
    },
  )

  it("takes a query, whatever it holds", async () => {
    const { port } = await boot()
    const targets = ["/mcp?x=1", "/mcp?", "/mcp?x=/../y", "/mcp?x=%2e%2e", "/mcp?a//b", "/mcp?x#y"]
    expect(await statuses(port, targets, POST_INITIALIZE)).toEqual(all(targets, 200))
    const probes = ["/health/live?probe=1", "/health/ready?x=/./y", "/metrics?a=/../b"]
    expect(await statuses(port, probes)).toEqual(all(probes, 200))
  })

  it("answers an asterisk-form OPTIONS instead of failing on it", async () => {
    const { port } = await boot()
    expect((await rawRequest(port, { method: "OPTIONS", target: "*" })).status).toBe(404)
    expect(failed).not.toHaveBeenCalled()
  })
})

describe("the listener: the refusal comes first", () => {
  it("before the Host check: a foreign Host reads 404 here, 403 on the route", async () => {
    const { port } = await boot()
    const host = "attacker.example"
    expect((await rawRequest(port, { target: "/./mcp", host })).status).toBe(404)
    expect((await rawRequest(port, { target: "/./health/live", host })).status).toBe(404)
    expect((await rawRequest(port, { target: "/mcp", host })).status).toBe(403)
  })

  it("before the Origin check", async () => {
    const { port } = await boot()
    const headers = { ...POST_INITIALIZE.headers, Origin: "https://attacker.example" }
    const request = { ...POST_INITIALIZE, headers }
    expect((await rawRequest(port, { ...request, target: "/./mcp" })).status).toBe(404)
    expect((await rawRequest(port, { ...request, target: "/mcp" })).status).toBe(403)
  })

  it("before OAuth: a request without a token reads 404 here, 401 on the route", async () => {
    const { port } = await boot({ oauth: stubOAuth() })
    expect((await rawRequest(port, { ...POST_INITIALIZE, target: "/./mcp" })).status).toBe(404)
    expect((await rawRequest(port, { ...POST_INITIALIZE, target: "/mcp" })).status).toBe(401)
  })

  it("before the metrics token: the alias of a closed /metrics is no way in", async () => {
    const { port } = await boot({ env: { MCP_METRICS_TOKEN: "s3cret" } })
    expect((await rawRequest(port, { target: "/./metrics" })).status).toBe(404)
    expect((await rawRequest(port, { target: "/metrics" })).status).toBe(401)
  })

  it("before the body: an open upload over the cap gets 404 here, 413 on the route", async () => {
    const { port } = await boot({ env: { MCP_MAX_BODY_BYTES: "64" } })
    const upload = { method: "POST", body: { length: 5000, sent: "x".repeat(10) } }
    expect((await rawRequest(port, { ...upload, target: "/./mcp" })).status).toBe(404)
    expect((await rawRequest(port, { ...upload, target: "/mcp" })).status).toBe(413)
  })

  it("leaves a drain nothing to wait for", async () => {
    const { server, port } = await boot()
    const upload = { method: "POST", target: "/./mcp", body: { length: 5000, sent: "x" } }
    expect((await rawRequest(port, upload)).status).toBe(404)
    const started = Date.now()
    await server.shutdown()
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe("the listener: what the metrics and the log make of it", () => {
  it("counts a refusal under route=other, and no path becomes a label", async () => {
    const { port } = await boot({ oauth: stubOAuth() })
    const targets = ROUTES.flatMap(({ route }) => [...notNormal(route, port), ...inside(route)])
    await statuses(port, targets)
    const metrics = await scrape(port)
    const count = Number(
      /^mcp_http_requests_total\{method="GET",route="other",status="404"\} (\d+)$/m.exec(
        metrics,
      )?.[1],
    )
    expect(count).toBe(targets.length)
    const labels = [...metrics.matchAll(/\broute="([^"]*)"/g)].map(([, route]) => route)
    expect(new Set(labels)).toEqual(new Set(["other"]))
    expect(metrics).toMatch(
      /^mcp_http_request_duration_seconds_count\{method="GET",route="other"\} /m,
    )
  })

  it("logs no fragment and no authority, which can carry a token or credentials", async () => {
    const { port } = await boot()
    await rawRequest(port, { target: "/mcp#access_token=s3cret" })
    await rawRequest(port, { target: "//user:s3cret@127.0.0.1/mcp" })
    await rawRequest(port, { target: "/\\user:s3cret@127.0.0.1/mcp" })
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines).toEqual([
      expect.stringMatching(/^GET \/mcp 404 0ms ERROR Not found/),
      expect.stringMatching(/^GET \(not origin-form\) 404 0ms ERROR Not found/),
      expect.stringMatching(/^GET \(not origin-form\) 404 0ms ERROR Not found/),
    ])
  })

  it("logs a refusal in one line with the path as sent, not its query", async () => {
    const { port } = await boot()
    await rawRequest(port, { target: "/x/../mcp?token=s3cret", method: "POST" })
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines).toEqual([expect.stringMatching(/^POST \/x\/\.\.\/mcp 404 0ms ERROR Not found: /)])
    expect(lines[0]).not.toContain("s3cret")
  })

  it("keeps an encoded line break as text: nothing forges a second line", async () => {
    const { port } = await boot()
    await rawRequest(port, { target: "/./mcp%0D%0AGET%20/forged%20200%201ms" })
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toMatch(/[\r\n]/)
    expect(lines[0]).toContain("/./mcp%0D%0AGET%20/forged%20200%201ms 404")
  })

  it.each(["/./mcp\r\nGET /forged 200 1ms", "/./mcp\nGET /forged", "/./mcp\t", "/./mcp\x85"])(
    "lets Node's parser refuse raw %j: it never reaches the log",
    async (target) => {
      const { port } = await boot()
      expect((await rawRequest(port, { target })).status).toBe(400)
      expect(log).not.toHaveBeenCalled()
    },
  )

  it("writes no absolute target, which can carry credentials, and no stack", async () => {
    const { port } = await boot()
    const target = `http://user:s3cret@127.0.0.1:${port}/mcp`
    expect((await rawRequest(port, { target })).status).toBe(404)
    const lines = log.mock.calls.map(([line]) => String(line))
    expect(lines).toEqual([
      expect.stringMatching(/^GET \(not origin-form\) 404 0ms ERROR Not found/),
    ])
    expect(failed).not.toHaveBeenCalled()
  })
})

// The SDK's bridge builds the URL as `http://<Host><target>`: such a `Host` would route `/x` to
// `/mcp`, past any rule on the path, and an empty one would turn the first segment into the host.
describe("the listener: a Host cannot replace the path", () => {
  it.each(["/mcp?", "/mcp#", "\\mcp?", "/./mcp?"])(
    "refuses Host h%s on POST /x instead of serving /mcp",
    async (suffix) => {
      const { port } = await boot()
      const request = { ...POST_INITIALIZE, target: "/x", host: `127.0.0.1:${port}${suffix}` }
      expect((await rawRequest(port, request)).status).toBe(400)
    },
  )

  it.each(["/health/live?", "/metrics#"])(
    "refuses Host h%s on GET /x, in front of the unguarded routes too",
    async (suffix) => {
      const { port } = await boot()
      const request = { target: "/x", host: `127.0.0.1:${port}${suffix}` }
      expect((await rawRequest(port, request)).status).toBe(400)
    },
  )

  // A backslash alone: the URL parser reads it as a slash, so /live would answer from /health/live.
  it("refuses Host h\\health on GET /live, in front of what the parser makes of it", async () => {
    const { port } = await boot()
    const request = { target: "/live", host: `127.0.0.1:${port}\\health` }
    expect((await rawRequest(port, request)).status).toBe(400)
  })

  it("refuses an empty Host, whose target's first segment would become the host", async () => {
    const { port } = await boot()
    const request = { target: "/localhost/health/live", host: "" }
    expect((await rawRequest(port, request)).status).toBe(400)
  })

  it("holds with the Host check off", async () => {
    const { port } = await boot({ env: { MCP_ALLOWED_HOSTS: "*" } })
    const request = { ...POST_INITIALIZE, target: "/x", host: "anything/mcp?" }
    expect((await rawRequest(port, request)).status).toBe(400)
  })

  it("counts it under route=other", async () => {
    const { port } = await boot()
    await rawRequest(port, { target: "/x", host: "h/mcp?" })
    expect(await scrape(port)).toMatch(
      /^mcp_http_requests_total\{method="GET",route="other",status="400"\} 1$/m,
    )
  })

  // The bridge cannot build a `Request` of these: a 500 with a stack and the Host in the log.
  it.each(["a b", "%", "[", "127.0.0.1:abc", "127.0.0.1:99999", "user:s3cret@127.0.0.1", "\x85"])(
    "answers Host %j with 400 and one line in the log, also on an open route",
    async (host) => {
      const { port } = await boot()
      expect((await rawRequest(port, { target: "/health/live", host })).status).toBe(400)
      expect(failed).not.toHaveBeenCalled()
      const lines = log.mock.calls.map(([line]) => String(line))
      expect(lines).toEqual([
        expect.stringMatching(/^GET \/health\/live 400 0ms ERROR Bad request: the Host header/),
      ])
      expect(lines[0]).not.toContain("s3cret")
    },
  )

  it("takes every Host a client sends", async () => {
    const { port } = await boot()
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, "localhost"]) {
      expect((await rawRequest(port, { target: "/health/live", host })).status).toBe(200)
    }
  })
})

// `new Request` runs the URL parser, so a test through `app.fetch` never sends a dot segment: the
// sockets above cover those. Everything the parser leaves ends the same way here.
describe("app.fetch: what a Request lets through", () => {
  const get = (composed: { app: { fetch(r: Request): Promise<Response> } }, path: string) =>
    composed.app.fetch(new Request(`http://localhost${path}`, { headers: { host: "localhost" } }))

  it("has lost its dot segments before the app sees them", async () => {
    const composed = await compose()
    expect(new Request("http://localhost/./health/live").url).toBe("http://localhost/health/live")
    expect((await get(composed, "/./health/live")).status).toBe(200)
    expect((await get(composed, "/%2e/health/live")).status).toBe(200)
  })

  it.each(["//mcp", "/mcp/", "/mcp//", "/health//live", "/health/live/", "/metrics/", "//metrics"])(
    "refuses %s as the listener does",
    async (path) => {
      const composed = await compose()
      expect((await get(composed, path)).status).toBe(404)
    },
  )

  it("refuses the trailing slash the discovery route would otherwise answer", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const path = "/.well-known/oauth-protected-resource/mcp"
    expect((await get(composed, path)).status).toBe(200)
    expect((await get(composed, `${path}/`)).status).toBe(404)
  })

  it("counts it under route=other, comes before the Host check and logs one line", async () => {
    const composed = await compose()
    const foreign = new Request("http://localhost/mcp/", { headers: { host: "attacker.example" } })
    expect((await composed.app.fetch(foreign)).status).toBe(404)
    const metrics = await (await get(composed, "/metrics")).text()
    expect(metrics).toMatch(
      /^mcp_http_requests_total\{method="GET",route="other",status="404"\} 1$/m,
    )
    expect(metrics).not.toMatch(/route="\/mcp"/)
    expect(log.mock.calls.map(([line]) => String(line))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^GET \/mcp\/ 404 0ms ERROR Not found/)]),
    )
  })
})
