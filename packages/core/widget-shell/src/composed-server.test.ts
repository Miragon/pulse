import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ComposableModule, ModuleEntry } from "./composition.js"
import {
  composedEnvVars,
  createComposedServer,
  DEFAULT_DRAIN_TIMEOUT_MS,
  retiredEnvVars,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { HTTP_EDGE_ENV_VARS } from "./http-edge.js"
import { OAUTH_ENV_VARS } from "./oauth-env.js"
import { createToolsetVocabulary } from "./toolsets.js"

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: (env) => ({ url: env.ALPHA_URL ?? "default" }),
  knownEnvVars: ["ALPHA_URL"],
  toolsets: createToolsetVocabulary("alpha", ["read-only", "operations"] as const, "read-only", {
    authenticatedDefault: "operations",
  }),
  createPlugin: () => ({ name: "alpha", register: () => {} }),
}

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
    info: {
      name: "test-root",
      version: "9.8.7",
      title: "Test Server",
      websiteUrl: "https://example.com/test",
      instructions: "Be brief.",
    },
    modules: [alpha],
    // The bundle is read once; a missing file only warns (views render empty).
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  }
}

/** `alpha` with a `createPlugin` spy, to see whether (and with what) the boot built its plugin. */
function spiedAlpha() {
  const createPlugin = vi.fn((config: Record<string, unknown>, shared: object) =>
    alpha.createPlugin(config, shared),
  )
  return { module: { ...alpha, createPlugin }, createPlugin }
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

describe("createComposedServer: boot", () => {
  it("resolves ONE selection from the modules and logs the HTTP edge", async () => {
    const composed = await createComposedServer(options())
    expect(composed.boot.entries).toEqual([
      { app: "alpha", config: { url: "default", toolset: "read-only" } },
    ])
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[test-root\] HTTP edge: hosts localhost, 127\.0\.0\.1, \[::1\];/),
    )
  })

  it("fails the boot on an invalid edge setting before any plugin is created", async () => {
    const { module, createPlugin } = spiedAlpha()
    await expect(
      createComposedServer(options({ modules: [module], env: { MCP_MAX_BODY_BYTES: "lots" } })),
    ).rejects.toThrow(/MCP_MAX_BODY_BYTES/)
    expect(createPlugin).not.toHaveBeenCalled()
  })

  it("hands every plugin the shared resources the root builds from the active entries", async () => {
    const { module, createPlugin } = spiedAlpha()
    const shared = (entries: readonly ModuleEntry[]) => ({ names: entries.map((e) => e.app) })
    await createComposedServer(options({ modules: [module], shared }))
    expect(createPlugin).toHaveBeenCalledWith(
      { url: "default", toolset: "read-only" },
      { names: ["alpha"] },
    )
  })

  // A module may key per-boot state on its config object (the engine module's one engine registry,
  // shared by its tools and the BPMN lookup it hands analytics through `shared`).
  it("hands `shared` and createPlugin the same config object of an entry", async () => {
    const { module, createPlugin } = spiedAlpha()
    const seen: Record<string, unknown>[] = []
    const shared = (entries: readonly ModuleEntry[]) => {
      seen.push(...entries.map((entry) => entry.config))
      return {}
    }
    await createComposedServer(options({ modules: [module], shared }))
    expect(seen).toHaveLength(1)
    expect(createPlugin.mock.calls[0]?.[0]).toBe(seen[0])
  })

  it("names the boot's variables and every module's in composedEnvVars", () => {
    expect([...composedEnvVars([alpha])].sort()).toEqual(
      [
        ...HTTP_EDGE_ENV_VARS,
        ...OAUTH_ENV_VARS,
        "MCP_ACTIVE_MODULES",
        "MCP_USE_LOG_LEVEL",
        "ALPHA_URL",
      ].sort(),
    )
  })

  it("names every variable the modules retired in retiredEnvVars, none of them read", () => {
    const retiring = { ...alpha, retired: { names: ["alpha0"], envVars: { OLD_URL: "ALPHA_URL" } } }
    expect([...retiredEnvVars([retiring])]).toEqual(["OLD_URL"])
    expect(composedEnvVars([retiring]).has("OLD_URL")).toBe(false)
    expect([...retiredEnvVars([alpha])]).toEqual([])
  })

  it("refuses a retired setting FIRST, before the edge or OAuth checks and any plugin", async () => {
    const { module, createPlugin } = spiedAlpha()
    const retiring = {
      ...module,
      retired: { names: ["alpha0"], envVars: { OLD_URL: "ALPHA_URL" } },
    }
    await expect(
      createComposedServer(
        options({ modules: [retiring], env: { OLD_URL: "x", MCP_MAX_BODY_BYTES: "lots" } }),
      ),
    ).rejects.toThrow("OLD_URL is no longer read")
    await expect(
      createComposedServer(
        options({
          modules: [retiring],
          env: { MCP_ACTIVE_MODULES: "alpha0:operations", MCP_USE_OAUTH_KEYCLOAK_REALM: "r" },
        }),
      ),
    ).rejects.toThrow("Write alpha instead: alpha0:operations becomes alpha:operations.")
    expect(createPlugin).not.toHaveBeenCalled()
    const warnings = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(warnings).toEqual([])
  })

  it("knows the edge env vars in the typo warner", async () => {
    await createComposedServer(
      options({ env: { MCP_ALLOWED_HOSTS: "a.example", ALPHA_URL: "x", MCP_TYPO: "1" } }),
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

describe("createComposedServer: on the wire", () => {
  it("reports serverInfo and instructions from the root's info", async () => {
    const { server } = await boot()
    const res = await initialize(server.port)
    expect(res.status).toBe(200)
    const result = rpcResult(res.body)
    expect(result.serverInfo).toMatchObject({
      name: "test-root",
      version: "9.8.7",
      title: "Test Server",
      websiteUrl: "https://example.com/test",
    })
    expect(result.instructions).toBe("Be brief.")
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
  })

  it("appends each active module's instructions to the root's preamble", async () => {
    const instructed = {
      ...alpha,
      instructions: (config: Record<string, unknown>) => `alpha routes to ${String(config.url)}.`,
    }
    const { server } = await boot({ modules: [instructed] })
    const result = rpcResult((await initialize(server.port)).body)
    expect(result.instructions).toBe("Be brief.\n\nalpha routes to default.")
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

describe("createComposedServer: graceful drain", () => {
  it("drains: readiness 503, in-flight requests finish, then the drain ends", async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { composed, server } = await boot({ modules: [] })
    // Stands in for an in-flight tool call; registered before the first request mounts the app.
    let arrived!: () => void
    const received = new Promise<void>((resolve) => (arrived = resolve))
    composed.app.get("/slow", async () => {
      arrived()
      await gate
      order.push("slow answered")
      return new Response("done")
    })
    const inFlight = request(server.port, { path: "/slow" })
    await vi.waitFor(async () => {
      const ready = await request(server.port, { path: "/health/ready" })
      expect(ready.status).toBe(200)
    })
    // The request is in flight once its handler runs; a fixed sleep would race a loaded machine.
    await received

    const shutdown = server.shutdown()
    expect(server.shutdown()).toBe(shutdown)
    void shutdown.then(() => order.push("drained"))
    // No new connections once draining.
    await expect(request(server.port, { path: "/health/live" })).rejects.toThrow(/ECONNREFUSED/)
    release()
    expect((await inFlight).body).toBe("done")
    await shutdown
    expect(order).toEqual(["slow answered", "drained"])
  })

  it("stops waiting for a hung request after the drain timeout", async () => {
    const { composed, server } = await boot({ modules: [] }, 30)
    let arrived!: () => void
    const received = new Promise<void>((resolve) => (arrived = resolve))
    composed.app.get("/hang", () => {
      arrived()
      return new Promise<Response>(() => {})
    })
    const hung = request(server.port, { path: "/hang" }).catch((error: Error) => error)
    // Shut down only once the request is in flight; a fixed sleep raced a loaded machine.
    await received

    await server.shutdown()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[test-root] Drain timed out after 30ms"),
    )
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
    const composed = await createComposedServer(options({ modules: [] }))
    const server = await composed.listen({ port: 0, host: "127.0.0.1", handleSignals: true })
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"])

    handlers.get("SIGTERM")!()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    // The signal ran the same idempotent drain.
    await expect(request(server.port, { path: "/health/live" })).rejects.toThrow(/ECONNREFUSED/)
    await server.shutdown()
  })
})
