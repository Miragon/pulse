import fs from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SERVER_INSTRUCTIONS } from "../src/app.js"
import { bootServer, TEST_TOKENS, type BootedServer } from "./boot-server.js"
import { initializeRequest, rawRequest, streamOversizedBody } from "./raw-http.js"

const MIB = 1024 * 1024

const errorMessage = (body: string): string =>
  (JSON.parse(body) as { error: { message: string } }).error.message

/**
 * The #324 guardrail, on the wire against the REAL composition (`createApp`,
 * production defaults — no test-only bind tricks): DNS-rebinding protection
 * (Host on every request, Origin on non-GET requests that carry one) and a
 * body cap that answers 413 before the body is buffered.
 */
describe("HTTP edge — default policy (no MCP_URL: localhost-class only)", () => {
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer()
  })

  afterAll(async () => {
    await server?.close()
  })

  it("rejects a foreign Host with 403 and names the env vars that admit it", async () => {
    for (const host of ["attacker.example", `attacker.example:${server.port}`]) {
      const res = await initializeRequest(server.port, { host })
      expect(res.status, host).toBe(403)
      expect(errorMessage(res.body)).toMatch(/Host "attacker\.example" is not allowed/)
      expect(errorMessage(res.body)).toContain("MCP_ALLOWED_HOSTS")
    }
  })

  it("serves localhost-class Hosts, with or without a port", async () => {
    for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`, "localhost"]) {
      const res = await initializeRequest(server.port, { host })
      expect(res.status, host).toBe(200)
    }
  })

  it("rejects a foreign Origin with 403", async () => {
    for (const origin of ["https://attacker.example", "null"]) {
      const res = await initializeRequest(server.port, { origin })
      expect(res.status, origin).toBe(403)
      expect(errorMessage(res.body)).toContain("MCP_ALLOWED_ORIGINS")
    }
  })

  it("serves requests without an Origin (non-browser clients) and localhost origins", async () => {
    expect((await initializeRequest(server.port)).status).toBe(200)
    const inspector = await initializeRequest(server.port, { origin: "http://localhost:6274" })
    expect(inspector.status).toBe(200)
  })

  it("keeps the probes and the scrape reachable by IP-addressed infrastructure", async () => {
    for (const routePath of ["/health/ready", "/health/live", "/metrics"]) {
      const res = await rawRequest({
        port: server.port,
        path: routePath,
        headers: { host: "10.0.0.7:8400" },
      })
      expect(res.status, routePath).toBe(200)
    }
  })

  it("answers 413 for a declared Content-Length over the 4 MiB default without reading the body", async () => {
    // 1 KiB of the 5 MiB declared sent — `streamOversizedBody` rejects unless
    // the answer arrives while the rest is still owed.
    const res = await streamOversizedBody(server.port, {
      chunkBytes: 1024,
      contentLength: 5 * MIB,
    })
    expect(res.status).toBe(413)
    expect(res.headers.connection).toBe("close")
    expect(errorMessage(res.body)).toContain("MCP_MAX_BODY_BYTES")
  })

  it("answers 413 for an undeclared (chunked) body while the client is still sending", async () => {
    const res = await streamOversizedBody(server.port, { chunkBytes: 4 * MIB + 1 })
    expect(res.status).toBe(413)
    expect(res.headers.connection).toBe("close")
  })

  it("refuses a foreign Host's upload with 403 without reading the body", async () => {
    // Under the cap so only the guard can refuse it — and never finished, so
    // only a refusal before the body resolves the call.
    const res = await streamOversizedBody(server.port, {
      chunkBytes: 1024,
      contentLength: 2 * MIB,
      headers: { host: "attacker.example" },
    })
    expect(res.status).toBe(403)
    expect(errorMessage(res.body)).toMatch(/Host "attacker\.example" is not allowed/)
  })

  it("reports the package.json version, a title and the instructions on initialize", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { version: string }
    expect(server.client.getServerVersion()).toMatchObject({
      name: "pulse",
      version: pkg.version,
      title: "Pulse",
      websiteUrl: "https://github.com/Miragon/pulse",
    })
    // The root's preamble, then each active module's own snippet — the
    // engine routing rule lives there, not in 60-odd tool descriptions.
    const instructions = server.client.getInstructions() ?? ""
    expect(instructions.startsWith(`${SERVER_INSTRUCTIONS}\n\ncamunda7 (`)).toBe(true)
    expect(instructions).toContain('one engine is configured ("default"); `engine` may be omitted.')
    expect(instructions).toContain("\n\nanalytics (Prometheus metrics of the engines):")
  })
})

describe("HTTP edge — MCP_URL and the explicit allow-lists", () => {
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer({
      env: {
        MCP_URL: "https://mcp.example.com",
        MCP_ALLOWED_HOSTS: "mcp-server.internal",
        MCP_ALLOWED_ORIGINS: "https://app.example.com",
        MCP_MAX_BODY_BYTES: "2048",
      },
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("admits MCP_URL's host and the MCP_ALLOWED_HOSTS entries, nothing else", async () => {
    const status = async (host: string) => (await initializeRequest(server.port, { host })).status
    expect(await status("mcp.example.com")).toBe(200)
    expect(await status("mcp-server.internal:8400")).toBe(200)
    expect(await status("other.example.com")).toBe(403)
  })

  it("admits MCP_URL's origin and the MCP_ALLOWED_ORIGINS entries as exact origins", async () => {
    const status = async (origin: string) =>
      (await initializeRequest(server.port, { origin })).status
    expect(await status("https://mcp.example.com")).toBe(200)
    expect(await status("https://app.example.com")).toBe(200)
    expect(await status("http://app.example.com")).toBe(403)
    expect(await status("https://app.example.com.attacker.example")).toBe(403)
  })

  it("applies MCP_MAX_BODY_BYTES", async () => {
    expect((await initializeRequest(server.port)).status).toBe(200)
    const res = await rawRequest({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    })
    expect(res.status).toBe(413)
  })
})

/**
 * The readiness 503 while draining and the runtime shutdown after it are widget-shell's
 * (`composed-server.test.ts`, `health.test.ts`); here the real composition drains a tool call.
 */
describe("graceful drain", () => {
  it("finishes an in-flight tool call, then stops accepting connections", async () => {
    let reached!: () => void
    const inEngine = new Promise<void>((resolve) => (reached = resolve))
    // A slow engine: the call is still in flight when the drain begins.
    const engine = createServer((req, res) => {
      reached()
      setTimeout(() => {
        res.setHeader("content-type", "application/json")
        res.end(req.url?.includes("/process-definition/count") ? '{"count":0}' : "[]")
      }, 300)
    })
    await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
    const { port } = engine.address() as AddressInfo
    const server = await bootServer({
      env: { CAMUNDA_BASE_URL: `http://127.0.0.1:${port}/engine-rest` },
    })
    try {
      const call = server.client.callTool({
        name: "camunda7_list_process_definitions",
        arguments: {},
      })
      await inEngine
      const shutdown = server.running.shutdown()
      const result = await call
      expect(result.isError).toBeFalsy()

      await shutdown
      // Stopped accepting: new connections are refused.
      await expect(rawRequest({ port: server.port, path: "/health/live" })).rejects.toThrow(
        /ECONNREFUSED/,
      )
    } finally {
      await server.close()
      await new Promise<void>((resolve) => engine.close(() => resolve()))
    }
  })
})

describe("/metrics token (MCP_METRICS_TOKEN)", () => {
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer({ env: { MCP_METRICS_TOKEN: "s3cret" } })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("answers 401 without the bearer token and the scrape with it", async () => {
    const scrape = (authorization?: string) =>
      rawRequest({
        port: server.port,
        path: "/metrics",
        headers: authorization ? { authorization } : {},
      })
    const anonymous = await scrape()
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers["www-authenticate"]).toContain("Bearer")
    expect((await scrape("Bearer wrong")).status).toBe(401)
    const authorized = await scrape("Bearer s3cret")
    expect(authorized.status).toBe(200)
    expect(authorized.body).toContain("mcp_http_requests_total")
  })
})

describe("OAuth gate (stub provider — the authenticated boots run the real gate)", () => {
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer({ authenticated: true })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("answers 401 on /mcp without a bearer token and serves a known one", async () => {
    expect((await initializeRequest(server.port)).status).toBe(401)
    const authorized = await initializeRequest(server.port, {
      authorization: `Bearer ${TEST_TOKENS.bob}`,
    })
    expect(authorized.status).toBe(200)
  })
})
