import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { oauthCustomProvider } from "mcp-use/oauth"
import { composeModules, type ComposableModule } from "./composition.js"
import {
  createComposedServer,
  DEFAULT_DRAIN_TIMEOUT_MS,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { createShellPlugin } from "./shell-catalogue.js"
import { createToolsetVocabulary } from "./toolsets.js"

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: (env) => ({ url: env.ALPHA_URL ?? "default" }),
  knownEnvVars: ["ALPHA_URL"],
  toolsets: createToolsetVocabulary("alpha", ["read-only", "operations"] as const, "read-only", {
    authenticatedDefault: "operations",
  }),
  createPlugin: () => ({ definition: { name: "alpha", steps: [], widgets: [] } }),
}

const composition = composeModules<object>({
  label: "test-root",
  modules: [alpha],
  appEnvVars: ["MCP_ACTIVE_MODULES"],
})

const running: RunningServer[] = []
let info: MockInstance<(line: string) => void>

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.restoreAllMocks()
})

function options(overrides: Partial<ComposedServerOptions> = {}): ComposedServerOptions {
  return {
    label: "test-root",
    info: {
      name: "test-server",
      version: "9.8.7",
      title: "Test Server",
      websiteUrl: "https://example.com/test",
      instructions: "Be brief.",
    },
    composition,
    // The bundle is read once; a missing file only warns (views render empty).
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    setup: () => ({ plugins: [createShellPlugin(), ...composition.pluginsFor([], {})] }),
    ...overrides,
  }
}

async function boot(overrides: Partial<ComposedServerOptions> = {}, drainTimeoutMs?: number) {
  const composed = await createComposedServer(options(overrides))
  const server = await composed.listen({
    port: 0,
    host: "127.0.0.1",
    ...(drainTimeoutMs === undefined ? {} : { drainTimeoutMs }),
  })
  running.push(server)
  return { composed, server }
}

/** Raw HTTP (fetch cannot set `Host`), always on a fresh connection. */
function request(
  port: number,
  {
    method = "GET",
    path = "/",
    headers = {},
    body,
  }: {
    method?: string
    path?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        )
      },
    )
    req.on("error", reject)
    req.end(body)
  })
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

const initialize = (port: number, headers: Record<string, string> = {}) =>
  request(port, {
    method: "POST",
    path: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: INITIALIZE,
  })

function rpcResult(body: string): Record<string, unknown> {
  const json = body.trimStart().startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length)
  return (JSON.parse(json) as { result: Record<string, unknown> }).result
}

describe("createComposedServer — boot", () => {
  it("resolves ONE unauthenticated selection without OAuth and keeps the builder off", async () => {
    const composed = await createComposedServer(options())
    expect(composed.boot.authenticated).toBe(false)
    expect(composed.boot.entries).toEqual([
      { app: "alpha", config: { url: "default", toolset: "read-only" } },
    ])
    expect(composed.builder).toBe(false)
    expect(info).toHaveBeenCalledWith(
      "[test-root] Dashboard builder off (needs OAuth and no read-only module) — render-view stays.",
    )
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[test-root\] HTTP edge — hosts: localhost, 127\.0\.0\.1, \[::1\];/),
    )
  })

  it("hands the selection to setup() and authenticates it exactly when OAuth is installed", async () => {
    const setup = vi.fn(options().setup)
    const oauth = oauthCustomProvider<unknown>({
      resource: "http://localhost/mcp",
      oauthMetadata: {
        issuer: "https://idp.example.test",
        authorization_endpoint: "https://idp.example.test/a",
        token_endpoint: "https://idp.example.test/t",
        response_types_supported: ["code"],
      },
      createTokenVerifier: () => ({
        verifyAccessToken: () => Promise.reject(new Error("no tokens in this test")),
      }),
      mapAuthInfo: () => ({ user: {}, payload: {}, permissions: [] }),
    })
    const composed = await createComposedServer(options({ oauth, setup }))
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.entries[0].config).toMatchObject({ toolset: "operations" })
    expect(composed.builder).toBe(true)
    expect(setup).toHaveBeenCalledWith(composed.boot)
  })

  it("fails the boot when OAuth has no resource and MCP_URL is unset", async () => {
    const oauth = { resource: undefined } as unknown as ComposedServerOptions["oauth"]
    await expect(createComposedServer(options({ oauth }))).rejects.toThrow(
      "[test-root] OAuth needs MCP_URL",
    )
  })

  it("fails the boot on an invalid edge setting before running setup()", async () => {
    const setup = vi.fn(options().setup)
    await expect(
      createComposedServer(options({ env: { MCP_MAX_BODY_BYTES: "lots" }, setup })),
    ).rejects.toThrow(/MCP_MAX_BODY_BYTES/)
    expect(setup).not.toHaveBeenCalled()
  })

  it("knows the edge env vars and the root's extras in the typo warner", async () => {
    await createComposedServer(
      options({
        env: { MCP_ALLOWED_HOSTS: "a.example", MCP_SECRET_X: "1", MCP_TYPO: "1" },
        extraKnownEnvVars: ["MCP_SECRET_X"],
      }),
    )
    const warnings = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(warnings.filter((line) => line.includes("Unknown environment variable"))).toEqual([
      expect.stringContaining('"MCP_TYPO"'),
    ])
  })

  it("defaults telemetry off without overriding an explicit opt-in", async () => {
    vi.stubEnv("MCP_USE_ANONYMIZED_TELEMETRY", undefined)
    await createComposedServer(options())
    expect(process.env.MCP_USE_ANONYMIZED_TELEMETRY).toBe("false")
    vi.stubEnv("MCP_USE_ANONYMIZED_TELEMETRY", "true")
    await createComposedServer(options())
    expect(process.env.MCP_USE_ANONYMIZED_TELEMETRY).toBe("true")
    vi.unstubAllEnvs()
  })
})

describe("createComposedServer — on the wire", () => {
  it("reports serverInfo and instructions from the root's info", async () => {
    const { server } = await boot()
    const res = await initialize(server.port)
    expect(res.status).toBe(200)
    const result = rpcResult(res.body)
    expect(result.serverInfo).toMatchObject({
      name: "test-server",
      version: "9.8.7",
      title: "Test Server",
      websiteUrl: "https://example.com/test",
    })
    expect(result.instructions).toBe("Be brief.")
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
  })

  it("appends each active module's instructions to the root's preamble", async () => {
    const instructed = composeModules<object>({
      label: "test-root",
      modules: [
        {
          ...alpha,
          instructions: (config, { authenticated }) =>
            `alpha routes to ${String(config.url)} (${authenticated ? "signed in" : "anonymous"}).`,
        },
      ],
    })
    const { server } = await boot({ composition: instructed })
    const result = rpcResult((await initialize(server.port)).body)
    expect(result.instructions).toBe("Be brief.\n\nalpha routes to default (anonymous).")
  })

  it("guards /mcp by Host and Origin but leaves the probes and the scrape to IP callers", async () => {
    const { server } = await boot()
    expect((await initialize(server.port, { host: "attacker.example" })).status).toBe(403)
    expect((await initialize(server.port, { origin: "https://attacker.example" })).status).toBe(403)
    for (const path of ["/health/live", "/health/ready", "/metrics"]) {
      const res = await request(server.port, { path, headers: { host: "10.1.2.3:8400" } })
      expect(res.status, path).toBe(200)
    }
  })

  it("counts refused requests in the HTTP metrics", async () => {
    const { server } = await boot()
    await initialize(server.port, { host: "attacker.example" })
    const metrics = await request(server.port, { path: "/metrics" })
    expect(metrics.body).toMatch(
      /^mcp_http_requests_total\{method="POST",route="\/mcp",status="403"\} 1$/m,
    )
  })

  it("protects /metrics with MCP_METRICS_TOKEN", async () => {
    const { server } = await boot({ env: { MCP_METRICS_TOKEN: "t0ken" } })
    expect((await request(server.port, { path: "/metrics" })).status).toBe(401)
    const authorized = await request(server.port, {
      path: "/metrics",
      headers: { authorization: "Bearer t0ken" },
    })
    expect(authorized.status).toBe(200)
  })

  it("caps request bodies at MCP_MAX_BODY_BYTES", async () => {
    const { server } = await boot({ env: { MCP_MAX_BODY_BYTES: "64" } })
    const res = await request(server.port, {
      method: "POST",
      path: "/mcp",
      headers: { "content-type": "application/json" },
      body: INITIALIZE,
    })
    expect(res.status).toBe(413)
  })

  it("binds every interface by default and names it localhost", async () => {
    const composed = await createComposedServer(options())
    const server = await composed.listen({ port: 0 })
    running.push(server)
    expect(server.url).toBe(`http://localhost:${server.port}/mcp`)
    expect((await request(server.port, { path: "/health/live" })).status).toBe(200)
  })

  it("takes HOST from the env", async () => {
    const composed = await createComposedServer(options({ env: { HOST: "127.0.0.1" } }))
    const server = await composed.listen({ port: 0 })
    running.push(server)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
  })

  it("rejects listen() when the port is taken", async () => {
    const { server } = await boot()
    const composed = await createComposedServer(options())
    await expect(composed.listen({ port: server.port, host: "127.0.0.1" })).rejects.toThrow(
      /EADDRINUSE/,
    )
  })
})

describe("createComposedServer — graceful drain", () => {
  it("drains: readiness 503, in-flight requests finish, then the runtime shuts down", async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { composed, server } = await boot({
      setup: () => ({
        plugins: [createShellPlugin()],
        shutdown: () => {
          order.push("runtime.shutdown")
          return Promise.resolve()
        },
      }),
    })
    // Stands in for an in-flight tool call; registered before the first request mounts the app.
    composed.app.get("/slow", async () => {
      await gate
      order.push("slow answered")
      return new Response("done")
    })
    const inFlight = request(server.port, { path: "/slow" })
    await vi.waitFor(async () => {
      const ready = await request(server.port, { path: "/health/ready" })
      expect(ready.status).toBe(200)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const shutdown = server.shutdown()
    expect(server.shutdown()).toBe(shutdown)
    // No new connections once draining.
    await expect(request(server.port, { path: "/health/live" })).rejects.toThrow(/ECONNREFUSED/)
    release()
    expect((await inFlight).body).toBe("done")
    await shutdown
    expect(order).toEqual(["slow answered", "runtime.shutdown"])
  })

  it("stops waiting for a hung request after the drain timeout", async () => {
    const shutdownRuntime = vi.fn(async () => {})
    const { composed, server } = await boot(
      { setup: () => ({ plugins: [createShellPlugin()], shutdown: shutdownRuntime }) },
      30,
    )
    composed.app.get("/hang", () => new Promise<Response>(() => {}))
    const hung = request(server.port, { path: "/hang" }).catch((error: Error) => error)
    await new Promise((resolve) => setTimeout(resolve, 30))

    await server.shutdown()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[test-root] Drain timed out after 30ms"),
    )
    expect(shutdownRuntime).toHaveBeenCalledTimes(1)
    expect(await hung).toBeInstanceOf(Error)
  })

  it("defaults the drain timeout under Fly's 5 s kill timeout", () => {
    expect(DEFAULT_DRAIN_TIMEOUT_MS).toBeLessThan(5000)
  })

  it("drains on SIGTERM/SIGINT and exits 0 when asked to handle signals", async () => {
    const handlers = new Map<string, () => void>()
    vi.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as typeof process.once)
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    const shutdownRuntime = vi.fn(async () => {})
    const composed = await createComposedServer(
      options({ setup: () => ({ plugins: [createShellPlugin()], shutdown: shutdownRuntime }) }),
    )
    const server = await composed.listen({ port: 0, host: "127.0.0.1", handleSignals: true })
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"])

    handlers.get("SIGTERM")!()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(shutdownRuntime).toHaveBeenCalledTimes(1)
    await server.shutdown()
  })

  it("exits 1 when the drain fails", async () => {
    const handlers = new Map<string, () => void>()
    vi.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as typeof process.once)
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const composed = await createComposedServer(
      options({
        setup: () => ({
          plugins: [createShellPlugin()],
          shutdown: () => Promise.reject(new Error("pool stuck")),
        }),
      }),
    )
    await composed.listen({ port: 0, host: "127.0.0.1", handleSignals: true })

    handlers.get("SIGINT")!()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(error).toHaveBeenCalledWith("[test-root] shutdown failed:", expect.any(Error))
  })
})
