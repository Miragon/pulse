/**
 * @miragon/pulse-http/testing/loopback: the recording engine of a conformance case, on
 * loopback. Real sockets reached through a real fetch, so a case observes what a wiring of the
 * transport does on the wire (the network codes of a closed port, a self-signed certificate and
 * an unresolvable host included). It records each request as it reached the socket and answers
 * like Tomcat: a status line without a reason phrase. Every wiring runs the cases against this
 * one engine, never a copy of its own; it is the package's one module with Node built-ins
 * (node:http, node:https, node:crypto, the named exception of http-is-a-leaf), an entry of its
 * own, so `@miragon/pulse-http/testing` stays free of them, and no shipped code imports it.
 *
 * The same engine replays recorded answers (`startRecordedEngine`): each request gets the answer
 * of what it asks, whatever the order a client sends its requests in, so two clients that read
 * the same things over their own wires can be held to the same recorded engine.
 */
import { generateKeyPairSync, sign } from "node:crypto"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import type { CaseAnswer, Seen, TransportCase } from "../types.js"

export interface CaseEngine {
  /** Where the case's root is appended: `http(s)://127.0.0.1:<port>`, or an unresolvable host. */
  readonly origin: string
  readonly seen: readonly Seen[]
  close(): Promise<void>
}

/** DER of one ASN.1 element; lengths up to 64 KiB are all a certificate needs here. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const n = body.length
  const head = n < 0x80 ? [tag, n] : n < 0x100 ? [tag, 0x81, n] : [tag, 0x82, n >> 8, n & 0xff]
  return Buffer.concat([Buffer.from(head), body])
}

const sequence = (...parts: Buffer[]) => der(0x30, ...parts)
const objectId = (...bytes: number[]) => der(0x06, Buffer.from(bytes))
const ECDSA_SHA256 = sequence(objectId(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02))
const COMMON_NAME = objectId(0x55, 0x04, 0x03)

/** A self-signed certificate for 127.0.0.1 (X.509 v3, P-256), made at test time. */
function selfSigned() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const name = sequence(der(0x31, sequence(COMMON_NAME, der(0x0c, Buffer.from("127.0.0.1")))))
  const time = (value: string) => der(0x17, Buffer.from(value))
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    ECDSA_SHA256,
    name,
    sequence(time("200101000000Z"), time("491231235959Z")),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  )
  const signature = der(0x03, Buffer.from([0]), sign("sha256", tbs, privateKey))
  const base64 = sequence(tbs, ECDSA_SHA256, signature).toString("base64")
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    cert: `-----BEGIN CERTIFICATE-----\n${base64.replace(/.{64}/g, "$&\n")}\n-----END CERTIFICATE-----\n`,
  }
}

function sendBody(
  res: ServerResponse,
  body: Buffer,
  answer: CaseAnswer,
  timers: Set<NodeJS.Timeout>,
) {
  const trickle = answer.trickle
  if (trickle === undefined) {
    res.end(body)
    return
  }
  const size = Math.ceil(body.length / trickle.chunks)
  let sent = 0
  const next = () => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      res.write(body.subarray(sent * size, (sent + 1) * size))
      sent += 1
      if (sent < trickle.chunks) next()
      else res.end()
    }, trickle.everyMs)
    timers.add(timer)
  }
  next()
}

function answer(
  req: IncomingMessage,
  res: ServerResponse,
  reply: CaseAnswer,
  timers: Set<NodeJS.Timeout>,
) {
  if (reply.reset === true) {
    req.socket.destroy()
    return
  }
  if (reply.hang === "headers") return
  const body =
    reply.bytes === undefined ? Buffer.from(reply.body ?? "") : Buffer.alloc(reply.bytes, "x")
  const length = reply.announce === true ? { "Content-Length": String(body.length) } : {}
  res.writeHead(reply.status ?? 200, "", { ...length, ...reply.headers })
  if (reply.hang === "body") {
    res.flushHeaders()
    return
  }
  sendBody(res, body, reply, timers)
}

async function listening(
  server: http.Server,
  scheme: string,
  seen: Seen[],
  timers: Set<NodeJS.Timeout>,
): Promise<CaseEngine> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as { readonly port: number }
  return {
    origin: `${scheme}://127.0.0.1:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer)
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}

/**
 * A loopback port nothing listens on: port 2, below 1024 and not one the fetch standard blocks.
 * No test is ever handed it (an OS hands out ephemeral ports only), so no parallel engine can
 * take it, as one could take a port bound and released.
 */
const CLOSED_PORT = 2

/** The answer to a request the engine recorded, by the request and the count of requests so far. */
type Reply = (request: Seen, count: number) => CaseAnswer

/** Records each request as it reached the socket and answers it with `reply`. */
function recording(seen: Seen[], timers: Set<NodeJS.Timeout>, reply: Reply) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const { authorization } = req.headers
      // A Node server always has a method and a URL.
      const request: Seen = {
        method: String(req.method),
        target: String(req.url),
        body: Buffer.concat(chunks).toString("utf8"),
        ...(authorization ? { authorization } : {}),
      }
      seen.push(request)
      answer(req, res, reply(request, seen.length), timers)
    })
  }
}

/** The engine of `kase`, recording every request and answering with the case's answers in order. */
export async function startCaseEngine(kase: TransportCase): Promise<CaseEngine> {
  const { endpoint } = kase.connection
  if (endpoint === "closed-port") {
    const origin = `http://127.0.0.1:${String(CLOSED_PORT)}`
    return { origin, seen: [], close: () => Promise.resolve() }
  }
  if (endpoint === "unresolvable-host") {
    return { origin: "http://transport-case.invalid", seen: [], close: () => Promise.resolve() }
  }
  const seen: Seen[] = []
  const timers = new Set<NodeJS.Timeout>()
  // The last answer answers every request after it; a case without one answers 200.
  const handler = recording(seen, timers, (_, count) => ({
    ...kase.answers[Math.min(count, kase.answers.length) - 1],
  }))
  if (endpoint === "self-signed-tls") {
    return listening(https.createServer(selfSigned(), handler), "https", seen, timers)
  }
  return listening(http.createServer(handler), "http", seen, timers)
}

/** An answer of an engine as recorded: the request it answered and the JSON it answered with. */
export interface RecordedAnswer {
  readonly method: string
  /** The request's path, decoded: `/engine-rest/process-definition/a:1/xml`. */
  readonly path: string
  /** The request's query, decoded; a request matches with its parameters in any order. */
  readonly query?: Readonly<Record<string, string>>
  /** The request's JSON body; a request matches with the keys of its objects in any order. */
  readonly body?: unknown
  /** The JSON the engine answered with, which the recorded engine sends with status 200. */
  readonly answer: unknown
}

export interface RecordedEngine extends CaseEngine {
  /** The requests no recorded answer matched, each answered with a 500 that names it. */
  readonly unanswered: readonly Seen[]
}

/** Code unit order, which no locale changes. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A JSON value as text, the keys of each of its objects in code unit order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => byCodeUnits(a, b)))
      : entry,
  )
}

/** What a request asks, as text: its method, its decoded path, its query as a set, its body. */
function requestKey(
  method: string,
  path: string,
  query: readonly (readonly [string, string])[],
  body: string | undefined,
): string {
  const parameters = query.map((parameter) => JSON.stringify(parameter)).sort(byCodeUnits)
  return JSON.stringify([method, path, parameters, body ?? null])
}

/** A path with its escapes decoded; one that holds a malformed escape stays as it was sent. */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** A request's body as `canonical` writes its JSON; a body that is no JSON stays as it was sent. */
function canonicalBody(body: string): string | undefined {
  if (body === "") return undefined
  try {
    return canonical(JSON.parse(body))
  } catch {
    return body
  }
}

function recordedKey({ method, path, query = {}, body }: RecordedAnswer): string {
  const recordedBody = body === undefined ? undefined : canonical(body)
  return requestKey(method, path, Object.entries(query), recordedBody)
}

function seenKey({ method, target, body }: Seen): string {
  const url = new URL(target, "http://loopback")
  return requestKey(method, decodedPath(url.pathname), [...url.searchParams], canonicalBody(body))
}

/** The 500 of a request no recorded answer matched, naming it. */
function unrecorded({ method, target, body }: Seen): CaseAnswer {
  return {
    status: 500,
    headers: { "Content-Type": "text/plain" },
    body: `No recorded answer for ${method} ${target}${body === "" ? "" : ` ${body}`}`,
  }
}

/**
 * An engine that replays `answers`: each request gets the answer recorded for its method, its
 * decoded path, its query as a set of parameters and its JSON body, so a client may send its
 * requests in any order and encode them its own way. A request no answer matches gets a 500 that
 * names it and is listed in `unanswered`.
 */
export async function startRecordedEngine(
  answers: readonly RecordedAnswer[],
): Promise<RecordedEngine> {
  const replies = new Map(answers.map((recorded) => [recordedKey(recorded), recorded.answer]))
  const seen: Seen[] = []
  const unanswered: Seen[] = []
  const timers = new Set<NodeJS.Timeout>()
  const reply = (request: Seen): CaseAnswer => {
    const key = seenKey(request)
    if (!replies.has(key)) {
      unanswered.push(request)
      return unrecorded(request)
    }
    const json = { "Content-Type": "application/json" }
    return { status: 200, headers: json, body: JSON.stringify(replies.get(key)) }
  }
  const engine = await listening(
    http.createServer(recording(seen, timers, reply)),
    "http",
    seen,
    timers,
  )
  return { ...engine, unanswered }
}
