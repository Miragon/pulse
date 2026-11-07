import { readFile } from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import type { Client } from "@modelcontextprotocol/client"
import { viewResourceUri } from "@miragon/pulse-widget-shell/server"

/** What `GET /host/view` hands the host page: the served view, as a host receives it. */
export interface HostView {
  /** `resources/read` text of `ui://views/<tool>.html`, the document the server serves. */
  html: string
  /** `_meta.ui.csp` of that read (the host turns it into the frame's CSP). */
  csp: Record<string, string[]> | undefined
  /** The tool's `tools/list` entry, sent to the view as `hostContext.toolInfo.tool`. */
  tool: unknown
}

export interface HostBackend {
  url: string
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1024 * 1024
const HOST_PAGE = path.join(import.meta.dirname, "host-sim.html")

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error("request body too large")
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readView(client: Client, toolName: string): Promise<HostView> {
  const [{ contents }, { tools }] = await Promise.all([
    client.readResource({ uri: viewResourceUri(toolName) }),
    client.listTools(),
  ])
  const content = contents[0] as { text?: string; _meta?: { ui?: { csp?: HostView["csp"] } } }
  const tool = tools.find((t) => t.name === toolName)
  if (typeof content.text !== "string" || !tool) {
    throw new Error(`no view resource or tool for "${toolName}"`)
  }
  return { html: content.text, csp: content._meta?.ui?.csp, tool }
}

const errorBody = (err: unknown) => ({
  error: { message: err instanceof Error ? err.message : String(err) },
})

async function route(
  client: Client,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://host")
  const endpoint = `${req.method} ${url.pathname}`
  switch (endpoint) {
    case "GET /":
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(await readFile(HOST_PAGE))
      return
    case "GET /favicon.ico":
      // Keeps the browser's automatic request out of the console-error check.
      res.writeHead(204)
      res.end()
      return
    case "GET /host/view":
      sendJson(res, 200, await readView(client, url.searchParams.get("tool") ?? ""))
      return
    case "POST /host/call": {
      const { name, arguments: args } = (await readJsonBody(req)) as {
        name: string
        arguments?: Record<string, unknown>
      }
      const outcome = await client
        .callTool({ name, arguments: args ?? {} })
        .then((result) => ({ result }), errorBody)
      sendJson(res, 200, outcome)
      return
    }
    default:
      sendJson(res, 404, errorBody(`no route for ${endpoint}`))
  }
}

/**
 * The host's server side, as a real MCP Apps host has one: it reads the view
 * resource and proxies every `tools/call` to the MCP server over a real MCP
 * client. The page (host-sim.html) never talks to the server itself, and the
 * view only ever talks to the page (postMessage), exactly like in claude.ai.
 *
 * - `GET /`               the host page
 * - `GET /host/view?tool` {@link HostView} for one view-bound tool
 * - `POST /host/call`     `{ name, arguments }` → `{ result }` | `{ error }`
 *   (a tool's `isError` result is a `result`; only protocol failures are errors)
 */
export async function startHostBackend(client: Client): Promise<HostBackend> {
  const server = http.createServer((req, res) => {
    route(client, req, res).catch((err: unknown) => sendJson(res, 500, errorBody(err)))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
