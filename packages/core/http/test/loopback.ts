/**
 * The recording engine of a conformance case, on loopback: real sockets reached through Node's
 * fetch, so a case observes what the transport does on the wire (the network codes of a closed
 * port, a self-signed certificate and an unresolvable host included). It records each request as
 * it reached the socket and answers like Tomcat: a status line without a reason phrase. Every
 * wiring of the transport brings its own copy (an app never imports a package's tests); the
 * answers are the case's.
 */
import { generateKeyPairSync, sign } from "node:crypto"
import { once } from "node:events"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import type { AddressInfo } from "node:net"
import type { CaseAnswer, Seen, TransportCase } from "../src/testing/index.js"

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
) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
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
export async function startEngine(kase: TransportCase): Promise<CaseEngine> {
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
      seen.push({
        method: req.method ?? "",
        target: req.url ?? "",
        body,
        ...(authorization ? { authorization } : {}),
      })
      const reply = kase.answers[Math.min(seen.length, kase.answers.length) - 1] ?? {}
      answer(req, res, reply, timers)
    })
  }
  if (endpoint === "self-signed-tls") {
    return listening(https.createServer(selfSigned(), handler), "https", seen, timers)
  }
  return listening(http.createServer(handler), "http", seen, timers)
}
