/**
 * A recording proxy in front of an engine, for the recording script of c7-core's recorded status
 * engine (status-world.record.test.ts): it forwards each request to the engine and keeps it as
 * `startRecordedEngine` of @miragon/pulse-http/testing/loopback matches one (its method, its
 * decoded path, its query, its JSON body) with what the engine answered, the JSON or a text with
 * its content type. The recorded engine answers each request with a 200 of one answer, so the
 * proxy names what it could not replay: an answer that is no 200, a query that names a parameter
 * twice, a body that is no JSON and a request asked again that the engine answered otherwise.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import type { RecordedAnswer } from "@miragon/pulse-http/testing/loopback"

/** A JSON value as text, the keys of each of its objects in code unit order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry,
  )
}

/** What a request asks, as the recorded engine matches it. */
interface Asked {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
}

/** What a recorded request asks, as text: the key the recorded engine matches it by. */
function requestKey({ method, path, query, body }: Asked): string {
  return canonical([method, path, query ?? {}, body ?? null])
}

/** An id the engine assigns anew on each run (a UUID), in a path, a query, a body or an answer. */
const ENGINE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const masked = (text: string) => text.replaceAll(ENGINE_ID, "<id>")

/**
 * Where a kept answer sorts: by its method, its path with the engine's ids masked and its query's
 * names, then by the whole request and its answer with those ids masked, its raw key only to break
 * a tie; so a recording made anew moves no answer whose request only changed its ids, and its diff
 * holds the real changes alone.
 */
function sortKeyOf(key: string, recorded: RecordedAnswer): readonly string[] {
  return [
    recorded.method,
    masked(recorded.path),
    Object.keys(recorded.query ?? {})
      .sort()
      .join("&"),
    masked(key),
    masked(canonical(recorded)),
    key,
  ]
}

function bySortKey(a: readonly string[], b: readonly string[]): number {
  const at = a.findIndex((part, index) => part !== b[index])
  if (at === -1) return 0
  return (a[at] ?? "") < (b[at] ?? "") ? -1 : 1
}

/** A proxy in front of the engine at `origin`: its own origin, what it kept, what it could not. */
export interface RecordingProxy {
  readonly origin: string
  /** Each request once with its answer, in the order of `sortKeyOf`. */
  answers(): RecordedAnswer[]
  /** What the recorded engine could not replay, each named. */
  readonly problems: readonly string[]
  close(): Promise<void>
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

/** The request as recorded, or why it cannot be. */
function requestOf(method: string, target: string, text: string): Asked | string {
  const url = new URL(target, "http://proxy")
  const parameters = [...url.searchParams]
  if (new Set(parameters.map(([name]) => name)).size !== parameters.length) {
    return `${method} ${target}: a query parameter twice`
  }
  let body: unknown
  try {
    body = text === "" ? undefined : JSON.parse(text)
  } catch {
    return `${method} ${target}: a body that is no JSON`
  }
  return {
    method,
    path: decodeURIComponent(url.pathname),
    ...(parameters.length > 0 ? { query: Object.fromEntries(parameters) } : {}),
    ...(body === undefined ? {} : { body }),
  }
}

/** The answer as recorded: its JSON, else its text and content type. */
function answered(asked: Asked, contentType: string, text: string): RecordedAnswer {
  return contentType.includes("json")
    ? { ...asked, answer: JSON.parse(text) as unknown }
    : { ...asked, text, contentType: contentType.split(";")[0]?.trim() ?? "" }
}

/** Starts a recording proxy in front of the engine at `origin` (`http://host:port`). */
export async function startRecordingProxy(origin: string): Promise<RecordingProxy> {
  const kept = new Map<string, RecordedAnswer>()
  const problems: string[] = []
  const keep = (recorded: RecordedAnswer) => {
    const key = requestKey(recorded)
    const before = kept.get(key)
    if (before === undefined) kept.set(key, recorded)
    else if (canonical(before) !== canonical(recorded)) problems.push(`${key}: answered otherwise`)
  }
  const forward = async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET"
    const target = req.url ?? "/"
    const text = await bodyOf(req)
    const contentType = req.headers["content-type"]
    const upstream = await fetch(`${origin}${target}`, {
      method,
      headers: contentType === undefined ? {} : { "Content-Type": contentType },
      ...(text === "" ? {} : { body: text }),
      redirect: "manual",
    })
    const answer = await upstream.text()
    const answerType = upstream.headers.get("content-type") ?? ""
    const request = requestOf(method, target, text)
    if (typeof request === "string") problems.push(request)
    else if (upstream.status !== 200) problems.push(`${method} ${target}: HTTP ${upstream.status}`)
    else keep(answered(request, answerType, answer))
    res.writeHead(upstream.status, answerType === "" ? {} : { "Content-Type": answerType })
    res.end(answer)
  }
  const server = http.createServer((req, res) => {
    forward(req, res).catch((error: unknown) => {
      problems.push(`${req.method ?? "GET"} ${req.url ?? "/"}: ${String(error)}`)
      res.writeHead(502).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    answers: () =>
      [...kept]
        .map(([key, recorded]) => ({ order: sortKeyOf(key, recorded), recorded }))
        .sort((a, b) => bySortKey(a.order, b.order))
        .map(({ recorded }) => recorded),
    problems,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
