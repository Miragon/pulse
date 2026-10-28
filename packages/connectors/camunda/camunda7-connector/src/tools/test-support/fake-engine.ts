/**
 * A real loopback server behind the production wiring: a fetch stub would miss exactly the
 * serialization bugs these tests exist for.
 */
import { once } from "node:events"
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { z } from "zod"
import type { ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import type { Client } from "@miragon/pulse-camunda7-client"
import { createEngineRegistry, type EngineRegistry } from "../../lib/resolve-engine.js"
import { providerForEntry } from "../../providers/index.js"

export interface RecordedRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: IncomingHttpHeaders
  body: unknown
}

export interface FakeReply {
  status?: number
  body?: unknown
  contentType?: string
}

export type FakeRoute = FakeReply | ((request: RecordedRequest) => FakeReply)

/** Unknown routes get `fallback` (default: 204, a write's usual reply). */
export type FakeRoutes = Record<string, FakeRoute>

export interface FakeEngine {
  baseUrl: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

function parseBody(raw: string, contentType: string | undefined): unknown {
  if (raw.length === 0) return undefined
  if (contentType?.startsWith("application/json")) return JSON.parse(raw)
  return raw
}

function answer(res: ServerResponse, reply: FakeReply | undefined) {
  if (!reply) {
    res.writeHead(204)
    return res.end()
  }
  const contentType = reply.contentType ?? "application/json"
  res.writeHead(reply.status ?? 200, { "Content-Type": contentType })
  if (reply.body === undefined) return res.end()
  res.end(contentType === "application/json" ? JSON.stringify(reply.body) : String(reply.body))
}

export async function startFakeEngine(
  routes: FakeRoutes = {},
  fallback?: FakeRoute,
): Promise<FakeEngine> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://engine")
      // Decoded, so a definition id (`key:1:dep`) reads as written.
      const path = decodeURIComponent(url.pathname).replace(/^\/engine-rest/, "")
      const request: RecordedRequest = {
        method: req.method ?? "",
        path,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: parseBody(Buffer.concat(chunks).toString("utf8"), req.headers["content-type"]),
      }
      requests.push(request)
      const route = routes[`${req.method} ${path}`] ?? fallback
      answer(res, typeof route === "function" ? route(request) : route)
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/engine-rest`,
    requests,
    // A plain close() would wait out keep-alive sockets a fast-failing builder left open.
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

type Register = (config: ToolConfig<EngineRegistry>) => void

export function captureTools(
  ...registerFns: Array<(register: never) => void>
): Map<string, ToolConfig<EngineRegistry>> {
  const tools = new Map<string, ToolConfig<EngineRegistry>>()
  const register: Register = (config) => tools.set(config.name, config)
  const recorder = Object.assign(register, { getRegisteredTools: () => [] })
  for (const fn of registerFns) fn(recorder as never)
  return tools
}

export function registryFor(engine: FakeEngine): EngineRegistry {
  return createEngineRegistry([{ id: "fake", baseUrl: engine.baseUrl }], (e) =>
    providerForEntry(e).createClient(e, { type: "none" }),
  )
}

export function clientFor(engine: FakeEngine): Client {
  return registryFor(engine).backends.resolve("fake").client
}

type Handler = (registry: EngineRegistry, args: Record<string, unknown>) => Promise<unknown>

/** Validates STRICT like the registrar (`strictInput`), so an unknown key fails here too. */
export function callTool(
  config: ToolConfig<EngineRegistry>,
  registry: EngineRegistry,
  args: Record<string, unknown>,
): Promise<unknown> {
  const parsed = z.strictObject(config.inputSchema ?? {}).parse(args)
  return (config as unknown as { handler: Handler }).handler(registry, parsed)
}
