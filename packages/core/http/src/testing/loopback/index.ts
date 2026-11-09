/**
 * @miragon/pulse-http/testing/loopback: the recording engine of a conformance case, on
 * loopback. Real sockets reached through a real fetch, so a case observes what a wiring of the
 * transport does on the wire (the network codes of a closed port, a self-signed certificate and
 * an unresolvable host included). It records each request as it reached the socket and answers
 * like Tomcat: a status line without a reason phrase. Every wiring runs the cases against this
 * one engine, never a copy of its own; it is the package's one module with Node built-ins
 * (node:http, node:https, node:crypto, the named exception of http-is-a-leaf), an entry of its
 * own, so `@miragon/pulse-http/testing` stays free of them, and no shipped code imports it.
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
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const { authorization } = req.headers
      const body = Buffer.concat(chunks).toString("utf8")
      // A Node server always has a method and a URL.
      seen.push({
        method: String(req.method),
        target: String(req.url),
        body,
        ...(authorization ? { authorization } : {}),
      })
      // The last answer answers every request after it; a case without one answers 200.
      const reply: CaseAnswer = { ...kase.answers[Math.min(seen.length, kase.answers.length) - 1] }
      answer(req, res, reply, timers)
    })
  }
  if (endpoint === "self-signed-tls") {
    return listening(https.createServer(selfSigned(), handler), "https", seen, timers)
  }
  return listening(http.createServer(handler), "http", seen, timers)
}
