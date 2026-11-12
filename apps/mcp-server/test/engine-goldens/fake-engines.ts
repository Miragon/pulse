import { generateKeyPairSync, sign } from "node:crypto"
import { once } from "node:events"
import http from "node:http"
import https from "node:https"
import type { AddressInfo } from "node:net"

/**
 * Loopback engines for the output and error-path goldens: real sockets behind the real boot, so
 * what a golden pins is what the server's client does on the wire (a fetch stub would hide the
 * URL resolution, the header checks and the network codes these goldens exist for). Each engine
 * records the request line as sent (the raw target, before any decoding) and its Authorization,
 * and answers like the Tomcat CIB seven runs in: a status line without a reason phrase.
 */

export interface SentRequest {
  method: string
  /** The request target as it reached the socket: `/engine-rest//x` stays `/engine-rest//x`. */
  target: string
  authorization: string | undefined
}

export interface EngineReply {
  status?: number
  /** JSON unless `raw`, which goes out byte for byte (an integer beyond 2^53, a stacktrace). */
  body?: unknown
  raw?: string
  /** Default: application/json for a `body`, none for a `raw` text or no body. */
  contentType?: string
  headers?: Record<string, string>
}

/** Answers a request by its method and target; `undefined` is a 404 NotFoundException. */
export type EngineAnswer = (request: SentRequest) => EngineReply | undefined

export interface LoopbackEngine {
  /** `http(s)://127.0.0.1:<port>`: the REST root is `${origin}/engine-rest`. */
  origin: string
  requests: SentRequest[]
  /**
   * Starts a probe: forgets the requests so far and answers none before `round` have arrived
   * (0: each at once), so a read that fails cannot end the call before a parallel read of the
   * same round went out. `round` is the number of reads the call starts before any answer.
   */
  begin(round: number): void
  /** After a probe: how many requests had come when the brake answered a round never filled. */
  shortRound(): number | undefined
  close(): Promise<void>
}

const NOT_FOUND: EngineReply = {
  status: 404,
  body: { type: "NotFoundException", message: "RESTEASY003210: Could not find resource" },
}

function reply(res: http.ServerResponse, answer: EngineReply | undefined) {
  const { status = 200, body, raw, headers } = answer ?? NOT_FOUND
  const contentType = answer?.contentType ?? (body === undefined ? undefined : "application/json")
  res.writeHead(status, "", { ...(contentType ? { "Content-Type": contentType } : {}), ...headers })
  res.end(raw ?? JSON.stringify(body))
}

/** A request as the engine saw it; a Node server always has a method and a URL. */
function recorded(req: http.IncomingMessage): SentRequest {
  return {
    method: String(req.method),
    target: String(req.url),
    authorization: req.headers.authorization,
  }
}

/** How long a held round waits for its missing requests before the engine answers anyway. */
const BRAKE_MS = 2_000

/** The barrier behind `begin`: answers wait until the round is complete, or the brake ends it. */
function barrier() {
  let round = 0
  let arrived = 0
  let held: Array<() => void> = []
  let brake: ReturnType<typeof setTimeout> | undefined
  let short: number | undefined
  const open = () => {
    clearTimeout(brake)
    brake = undefined
    const waiting = held
    held = []
    for (const send of waiting) send()
  }
  return {
    begin(requests: number) {
      open()
      round = requests
      arrived = 0
      short = undefined
    },
    arrive() {
      arrived += 1
      if (arrived >= round) open()
    },
    answer(send: () => void) {
      if (arrived >= round) return send()
      held.push(send)
      brake ??= setTimeout(() => {
        short = arrived
        round = 0
        open()
      }, BRAKE_MS)
    },
    short: () => short,
  }
}

type Barrier = ReturnType<typeof barrier>

function handler(
  answer: EngineAnswer,
  requests: SentRequest[],
  gate: Barrier,
): http.RequestListener {
  return (req, res) => {
    const request = recorded(req)
    requests.push(request)
    gate.arrive()
    req.resume()
    req.on("end", () => gate.answer(() => reply(res, answer(request))))
  }
}

async function listening(
  server: http.Server,
  scheme: string,
  requests: SentRequest[],
  gate: Barrier = barrier(),
): Promise<LoopbackEngine> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    origin: `${scheme}://127.0.0.1:${port}`,
    requests,
    begin(round) {
      requests.length = 0
      gate.begin(round)
    },
    shortRound: gate.short,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

/**
 * A plain HTTP engine answering through `answer`. A read that fails ends the tool call, and the
 * call's end cancels the reads it started, so each probe names its round (`begin`): without the
 * barrier the golden would race on whether a parallel read of the same round still went out.
 */
export function startEngine(answer: EngineAnswer): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  const gate = barrier()
  return listening(http.createServer(handler(answer, requests, gate)), "http", requests, gate)
}

/** An engine that takes every request and never answers: only a deadline ends the call. */
export function startSilentEngine(): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  const server = http.createServer((req) => {
    requests.push(recorded(req))
  })
  return listening(server, "http", requests)
}

/** A loopback port nothing listens on: bound once, then released. */
export async function closedPort(): Promise<number> {
  const server = http.createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
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

/**
 * A self-signed certificate for 127.0.0.1 (X.509 v3, P-256), made at test time so the repo holds
 * no key: a client that trusts only the system's CAs refuses it with DEPTH_ZERO_SELF_SIGNED_CERT.
 */
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

/** An HTTPS engine behind a self-signed certificate: the TLS handshake fails before any request. */
export function startTlsEngine(answer: EngineAnswer): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  const gate = barrier()
  const server = https.createServer(selfSigned(), handler(answer, requests, gate))
  return listening(server, "https", requests, gate)
}

/**
 * A host under .invalid (RFC 6761): a resolver that answers it with NXDOMAIN fails the lookup
 * (ENOTFOUND). Offline the lookup fails with EAI_AGAIN instead, and a resolver that rewrites
 * NXDOMAIN reaches a real host: the dns-failure goldens assume neither.
 */
export const UNRESOLVABLE_ORIGIN = "http://engine.pulse-golden.invalid"

/** Ports vary per run: every `127.0.0.1:<n>` in a golden reads `127.0.0.1:<port>`. */
export function withoutPorts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")) as T
}
