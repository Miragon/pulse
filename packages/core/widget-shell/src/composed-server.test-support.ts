import http from "node:http"
import net from "node:net"
import type { ComposableModule, ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import { oauthCustomProvider } from "./oauth-providers.js"
import { SERVED_FONT_FILES, SERVED_FONT_PATH } from "./protocol/served-fonts.js"

export const answer = () => ({
  content: [{ type: "text" as const, text: "ok" }],
  structuredContent: {},
})

/** A plain tool without input: the boot makes it strict, `strictToolInput({})`. */
export const plain = (server: ModuleServer, name: string, config: { description?: string } = {}) =>
  server.registerTool(name, config, answer)

/** A module without toolsets around one plugin: the boot builds it like any other. */
export const moduleOf = (plugin: ModulePlugin): ComposableModule<object> => ({
  name: plugin.name,
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => plugin,
})

export const pluginOf = (name: string, ...toolNames: string[]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const toolName of toolNames) plain(server, toolName)
  },
})

export const withPlugins = (...plugins: ModulePlugin[]) => ({ modules: plugins.map(moduleOf) })

/** One JSON-RPC call on a fresh connection; the server is stateless, so no initialize first. */
export function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/mcp",
        agent: false,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          const json = body.trimStart().startsWith("{")
            ? body
            : body
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice("data: ".length)
          resolve((JSON.parse(json) as { result: Record<string, unknown> }).result)
        })
      },
    )
    req.on("error", reject)
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }))
  })
}

export interface RawRequest {
  method?: string
  target: string
  /** The header's value, `null` for no header; defaults to the server's own. */
  host?: string | null
  /** The whole body's `content-length` and the part of it to send; less leaves the upload open. */
  body?: { length: number; sent: string }
  headers?: Record<string, string>
  version?: "1.0" | "1.1"
  /** What the client asks of the connection; the answer is read either way. */
  connection?: "close" | "keep-alive"
}

export interface RawAnswer {
  status: number
  head: string
  body: string
}

/** How long an open upload may wait for its answer. */
const RAW_ANSWER_MS = 2000

/** The SDK's streams answer `connection: keep-alive` whatever the request asked, so no close comes. */
function isComplete({ head, body }: RawAnswer): boolean {
  const length = /^content-length: (\d+)$/im.exec(head)?.[1]
  if (length !== undefined) return body.length >= Number(length)
  return /^transfer-encoding: chunked$/im.test(head) && body.endsWith("0\r\n\r\n")
}

/**
 * One request written to a socket as given: `http.request` and `fetch` refuse or normalize the
 * targets and `Host` values these tests are about. Answered once the response is complete, or the
 * socket closes, so an upload left open still reads its answer.
 */
export function rawRequest(
  port: number,
  {
    method = "GET",
    target,
    host,
    body,
    headers = {},
    version = "1.1",
    connection = "close",
  }: RawRequest,
): Promise<RawAnswer> {
  const lines = [`${method} ${target} HTTP/${version}`, `Connection: ${connection}`]
  const hostValue = host === undefined ? `127.0.0.1:${port}` : host
  if (hostValue !== null) lines.push(`Host: ${hostValue}`)
  if (body) lines.push(`Content-Length: ${body.length}`)
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`)
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1")
    let received = ""
    const parsed = (): RawAnswer | undefined => {
      const end = received.indexOf("\r\n\r\n")
      if (end === -1) return undefined
      const head = received.slice(0, end)
      return {
        status: Number(head.split(" ", 2)[1]),
        head,
        body: received.slice(end + "\r\n\r\n".length),
      }
    }
    const finish = (answer: RawAnswer): void => {
      clearTimeout(unanswered)
      socket.destroy()
      resolve(answer)
    }
    const unanswered = setTimeout(() => {
      socket.destroy()
      reject(new Error(`no answer to ${method} ${target}`))
    }, RAW_ANSWER_MS)
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1")
      const answer = parsed()
      if (answer && isComplete(answer)) finish(answer)
    })
    socket.on("error", () => {})
    socket.on("close", () => {
      const answer = parsed()
      if (answer) finish(answer)
      else {
        clearTimeout(unanswered)
        reject(new Error(`the socket closed without an answer to ${method} ${target}`))
      }
    })
    socket.write(Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body?.sent ?? ""}`, "latin1"))
  })
}

/** A provider whose verifier knows no token: a reached `/mcp` answers 401. */
export const stubOAuth = () =>
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

export const POST_INITIALIZE: Partial<RawRequest> = {
  method: "POST",
  body: { length: Buffer.byteLength(INITIALIZE), sent: INITIALIZE },
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
}

const FONT = `${SERVED_FONT_PATH}/${SERVED_FONT_FILES.sans}`

/** Every route, with what it answers under its own name on a boot under OAuth and what it takes. */
export const ROUTES: {
  route: string
  reached: number
  request?: Partial<RawRequest>
  allow: string
}[] = [
  { route: "/mcp", reached: 401, request: POST_INITIALIZE, allow: "POST" },
  { route: "/health", reached: 200, allow: "GET, HEAD" },
  { route: "/health/live", reached: 200, allow: "GET, HEAD" },
  { route: "/health/ready", reached: 200, allow: "GET, HEAD" },
  { route: "/metrics", reached: 200, allow: "GET, HEAD" },
  { route: "/.well-known/oauth-protected-resource/mcp", reached: 200, allow: "GET, HEAD, OPTIONS" },
  { route: FONT, reached: 200, allow: "GET, HEAD" },
]

/** One after the other: a burst of sockets overflows a small listen backlog (macOS: 128). */
export async function statuses(
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

export const all = (targets: readonly string[], status: number) =>
  Object.fromEntries(targets.map((target) => [target, status]))

export const scrape = async (port: number) => (await rawRequest(port, { target: "/metrics" })).body
