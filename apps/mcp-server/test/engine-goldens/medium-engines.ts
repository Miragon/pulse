import { once } from "node:events"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { EngineReply } from "./fake-engines.js"

/**
 * One loopback server for the engines of the request-count golden (request-counts.golden.test.ts):
 * each engine answers under its own prefix, `/<engine>/engine-rest`, through the routes of its
 * world (medium-world.ts), and every request is recorded as its operation, `METHOD <template>`
 * with the REST API's path template (`GET /process-definition/{id}/xml`), so the golden counts
 * operations, not ids, with the status of its answer. A request no route answers is a 404
 * NotFoundException and is recorded as `unanswered: METHOD <path>`, which the golden's test
 * refuses, as it refuses a parameter the world did not read and an answer that failed.
 */

/**
 * One request as a route reads it: its query and, for a POST, its JSON body, and the names of the
 * parameters its answer read (`read`), so a parameter the world does not know shows.
 */
export interface WorldRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly body: Record<string, unknown>
  readonly read: Set<string>
}

/** The answer of one route; the template's placeholders come as `params`. */
export type RouteAnswer = (
  request: WorldRequest,
  params: Readonly<Record<string, string>>,
) => EngineReply

/** A route: its method, its path template below the REST root, its answer. */
export interface WorldRoute {
  readonly method: "GET" | "POST"
  readonly template: string
  readonly answer: RouteAnswer
}

/** The requests of one engine, each as its operation. */
export interface SentOperation {
  readonly engine: string
  readonly operation: string
  /** The HTTP status of its answer. */
  readonly status: number
  /**
   * The parameters it sent that its answer did not read: a filter the world would ignore, or an
   * order it would not keep.
   */
  readonly unread: readonly string[]
}

/**
 * What pages or shapes an answer, and no filter: the world reads them on every list or none. An
 * order is no such parameter: the rows a capped page holds depend on it, so a route reads the
 * sorts it keeps (`Params.page`), and one it does not keep shows as ignored.
 */
const SHAPING = new Set(["firstResult", "maxResults", "deserializeValues", "deserializeValue"])

export interface MediumEngines {
  /** The REST root of `engine`. */
  urlOf(engine: string): string
  /** Every request since the last `reset`, in arrival order. */
  readonly sent: SentOperation[]
  reset(): void
  close(): Promise<void>
}

const NOT_FOUND: EngineReply = {
  status: 404,
  body: { type: "NotFoundException", message: "RESTEASY003210: Could not find resource" },
}

const segmentsOf = (path: string) => path.split("/").slice(1)
const isPlaceholder = (part: string) => part.startsWith("{") && part.endsWith("}")

/** The placeholders of `template` in `path`, or undefined when it does not match. */
function matchOf(template: string, path: string): Record<string, string> | undefined {
  const parts = segmentsOf(template)
  const segments = segmentsOf(path)
  if (parts.length !== segments.length) return undefined
  const params: Record<string, string> = {}
  for (const [at, part] of parts.entries()) {
    if (isPlaceholder(part)) params[part.slice(1, -1)] = decodeURIComponent(segments[at])
    else if (part !== segments[at]) return undefined
  }
  return params
}

/** The route of a request: a literal segment wins over a placeholder, as the REST API's do. */
function routeOf(routes: readonly WorldRoute[], method: string, path: string) {
  const matches = routes.flatMap((route) => {
    const params = route.method === method ? matchOf(route.template, path) : undefined
    return params ? [{ route, params, rank: Object.keys(params).length }] : []
  })
  return matches.sort((a, b) => a.rank - b.rank)[0]
}

/** One request the world answered: what it was, and the answer. */
export interface Answered extends SentOperation {
  readonly reply: EngineReply
}

/**
 * The answer of one engine's world to a request below its REST root: `path` with its query, and
 * the JSON body a POST sends.
 */
export function answerOf(
  routes: readonly WorldRoute[],
  method: string,
  target: string,
  text = "",
): Omit<Answered, "engine"> {
  const url = new URL(target, "http://engine")
  const found = routeOf(routes, method, url.pathname)
  const request: WorldRequest = {
    method,
    path: url.pathname,
    query: url.searchParams,
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
    read: new Set(),
  }
  const reply = found ? found.route.answer(request, found.params) : NOT_FOUND
  const names = [...new Set([...url.searchParams.keys(), ...Object.keys(request.body)])]
  return {
    operation: found
      ? `${method} ${found.route.template}`
      : `unanswered: ${method} ${url.pathname}`,
    status: reply.status ?? 200,
    unread: names.filter((name) => !SHAPING.has(name) && !request.read.has(name)).sort(),
    reply,
  }
}

function send(res: http.ServerResponse, { status = 200, body, raw, contentType }: EngineReply) {
  res.writeHead(status, "", { "Content-Type": contentType ?? "application/json" })
  res.end(raw ?? JSON.stringify(body))
}

/** The engine a request is for and the target below its REST root; none for another path. */
const PREFIX = /^\/([^/]+)\/engine-rest(\/.*)$/

/** Starts the engines: `worlds` maps each engine id to its world's routes. */
export async function startMediumEngines(
  worlds: Readonly<Record<string, readonly WorldRoute[]>>,
): Promise<MediumEngines> {
  const sent: SentOperation[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const [, engine = "", target = String(req.url)] = PREFIX.exec(String(req.url)) ?? []
      const text = Buffer.concat(chunks).toString("utf8")
      const { reply, ...operation } = answerOf(
        worlds[engine] ?? [],
        String(req.method),
        target,
        text,
      )
      sent.push({ engine, ...operation })
      send(res, reply)
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    urlOf: (engine) => `http://127.0.0.1:${port}/${engine}/engine-rest`,
    sent,
    reset: () => {
      sent.length = 0
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
