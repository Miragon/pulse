/**
 * A loopback engine that answers on the socket itself, for what a JSON fake cannot do: hang,
 * drop the connection, quote a credential back or send a status line of its own. Each request is
 * recorded as the socket saw it.
 *
 * It is no copy of the case engine of `@miragon/pulse-http/testing/loopback`, which plays the
 * scripted answers of one `TransportCase`, and the module runs every case it can express against
 * that one (transport-cases.test.ts). The cases check outcomes; this engine serves the tests that
 * pin the words the model reads, many routes on one socket, each a handler of its own (a proxy's
 * echo of the credential, a write answered late, two requests held until both are in flight).
 */
import { once } from "node:events"
import http from "node:http"
import type { AddressInfo } from "node:net"

interface SeenRequest {
  readonly method: string
  /** Below `/engine-rest`, as sent (still encoded), without the query. */
  readonly path: string
  readonly authorization: string | undefined
  readonly body: string
}

/** Answers one request; one that never writes leaves it hanging. */
export type RawRoute = (res: http.ServerResponse, req: http.IncomingMessage, body: string) => void

export interface RawEngine {
  /** The REST root, `http://127.0.0.1:<port>/engine-rest`. */
  readonly baseUrl: string
  readonly seen: SeenRequest[]
  close(): Promise<void>
}

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  // Tomcat's status line: no reason phrase.
  res.writeHead(status, "", { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

/** The request arrived (body read), then the connection drops. */
export const reset: RawRoute = (_, req) => {
  req.socket.destroy()
}

/** Never answers: only the deadline or the caller ends the call. */
export const hang: RawRoute = () => undefined

/**
 * Starts an engine answering `"<METHOD> <path>"` by `routes` (the path below `/engine-rest`,
 * without the query), anything else with `{"id":"ok"}`.
 */
export async function startRawEngine(
  routes: Readonly<Record<string, RawRoute>>,
): Promise<RawEngine> {
  const seen: SeenRequest[] = []
  const table = Object.entries(routes)
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")))
    req.on("end", () => {
      const path = (req.url ?? "").replace(/^\/engine-rest/, "").replace(/\?.*$/s, "")
      const method = req.method ?? ""
      seen.push({ method, path, authorization: req.headers.authorization, body })
      // Compared against the fixed table, never looked up by the request path.
      const route = table.find(([key]) => key === `${method} ${path}`)?.[1]
      if (route) route(res, req, body)
      else json(res, 200, { id: "ok" })
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/engine-rest`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

/** A loopback URL nothing listens on: a port bound once, then released (ECONNREFUSED). */
export async function closedPortUrl(): Promise<string> {
  const probe = http.createServer()
  probe.listen(0, "127.0.0.1")
  await once(probe, "listening")
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return `http://127.0.0.1:${String(port)}/engine-rest`
}
