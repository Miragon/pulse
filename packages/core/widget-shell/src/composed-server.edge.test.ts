import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { composeModules } from "./composition.js"
import {
  createComposedServer,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type ListenOptions,
  type RunningServer,
} from "./composed-server.js"
import { createShellPlugin } from "./shell-catalogue.js"

const composition = composeModules<object>({ label: "edge-test", modules: [], appEnvVars: [] })
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

const compose = (env: NodeJS.ProcessEnv = {}) =>
  createComposedServer({
    label: "edge-test",
    info: { name: "edge-test", version: "0.0.0" },
    composition,
    // The bundle is read once; a missing file only warns (views render empty).
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env,
    setup: () => ({ plugins: [createShellPlugin()] }),
  })

async function boot(env: NodeJS.ProcessEnv = {}, listen: ListenOptions = {}) {
  const composed = await compose(env)
  const server = await composed.listen({ port: 0, host: "127.0.0.1", ...listen })
  running.push(server)
  return { composed, server }
}

/** Raw HTTP (fetch cannot set `Host`), always on a fresh connection. */
function request(
  port: number,
  { method = "GET", path = "/", body }: { method?: string; path?: string; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      )
    })
    req.on("error", reject)
    req.end(body)
  })
}

/** Answers while the upload is still open; fails clearly instead of hanging. */
function openUpload(
  port: number,
  headers: Record<string, string>,
  path = "/mcp",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "POST", path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          clearTimeout(unanswered)
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
          req.destroy()
        })
      },
    )
    const unanswered = setTimeout(() => {
      req.destroy()
      reject(new Error("no answer while the upload was open"))
    }, 2000)
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ECONNRESET" && error.code !== "EPIPE") reject(error)
    })
    req.write(Buffer.alloc(10, 0x20))
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

describe("createComposedServer — admission before the body", () => {
  it("answers a foreign Host's POST from the guard without reading its body", async () => {
    const { server } = await boot({ MCP_MAX_BODY_BYTES: "64" })
    // Over the cap and never finished — the guard's 403 comes first anyway.
    const res = await openUpload(server.port, {
      host: "attacker.example",
      "content-type": "application/json",
      "content-length": "5000",
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('Host \\"attacker.example\\" is not allowed')
    const metrics = await request(server.port, { path: "/metrics" })
    expect(metrics.body).toMatch(
      /^mcp_http_requests_total\{method="POST",route="\/mcp",status="403"\} 1$/m,
    )
  })

  it("answers a foreign Origin's POST from the guard without reading its body", async () => {
    const { server } = await boot({ MCP_MAX_BODY_BYTES: "64" })
    const res = await openUpload(server.port, {
      origin: "https://attacker.example",
      "content-type": "application/json",
      "content-length": "5000",
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('Origin \\"https://attacker.example\\" is not allowed')
  })

  it("decides exemptions like the guard: a POST to an exempt path is read — and capped", async () => {
    const { server } = await boot({ MCP_MAX_BODY_BYTES: "64" })
    const headers = { host: "10.0.0.7:8400", "content-length": "5000" }
    expect((await openUpload(server.port, headers, "/health/x?probe=1")).status).toBe(413)
    // Not a prefix match on the string: `/healthz` is guarded, so refused unread.
    expect((await openUpload(server.port, headers, "/healthz")).status).toBe(403)
  })

  it("answers 503 once the in-flight body budget is spent", async () => {
    // Budget: 4 × 64 bytes — four held cap-sized bodies leave no room.
    const { composed, server } = await boot({ MCP_MAX_BODY_BYTES: "64" })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    composed.app.post("/hold", async () => {
      await gate
      return new Response("held")
    })
    composed.app.post("/probe", () => new Response("admitted"))
    const holders = Array.from({ length: 4 }, () =>
      request(server.port, { method: "POST", path: "/hold", body: "x".repeat(64) }),
    )
    await vi.waitFor(async () => {
      const res = await request(server.port, { method: "POST", path: "/probe", body: "y" })
      expect(res.status).toBe(503)
      expect(res.body).toContain("Server busy")
    })
    release()
    for (const holder of holders) expect((await holder).body).toBe("held")
    // The shares are released with the responses.
    await vi.waitFor(async () => {
      const after = await request(server.port, { method: "POST", path: "/probe", body: "y" })
      expect(after.body).toBe("admitted")
    })
  })

  it("cuts an upload that is not finished within the request timeout", async () => {
    const { server } = await boot({}, { requestTimeoutMs: 200 })
    const res = await openUpload(server.port, {
      "content-type": "application/json",
      "content-length": "100",
    })
    expect(res.status).toBe(408)
  })

  it("defaults the request timeout far below Node's 300 s", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000)
  })
})

describe("createComposedServer — under mcp-use dev (the CLI owns the socket)", () => {
  const TUNNEL_HOST = "k3x9.tunnel.example"

  const tunneled = (
    composed: { app: { fetch: (r: Request) => Promise<Response> } },
    origin?: string,
  ) =>
    composed.app.fetch(
      new Request(`http://${TUNNEL_HOST}/mcp`, {
        method: "POST",
        headers: {
          host: TUNNEL_HOST,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(origin ? { origin } : {}),
        },
        body: INITIALIZE,
      }),
    )

  it("defers the Host check to the CLI, so its tunnel reaches the server", async () => {
    const composed = await compose({ MCP_USE_DEV_CLI: "1" })
    expect((await tunneled(composed)).status).toBe(200)
    expect(info).toHaveBeenCalledWith(
      "[edge-test] mcp-use dev: the CLI checks Host (localhost-class + its tunnel); Origin is checked here.",
    )
  })

  it("keeps the Origin check, which the CLI does not do", async () => {
    const composed = await compose({ MCP_USE_DEV_CLI: "1" })
    expect((await tunneled(composed, "https://attacker.example")).status).toBe(403)
  })

  it("checks Host itself outside mcp-use dev", async () => {
    const composed = await compose()
    expect((await tunneled(composed)).status).toBe(403)
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("mcp-use dev:"))
  })
})
