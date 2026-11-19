import { generateKeyPairSync, sign } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createTlsServer } from "node:https"
import type { AddressInfo } from "node:net"

export interface SentRequest {
  readonly method: string
  readonly target: string
  readonly authorization?: string
  readonly contentType?: string
  readonly body?: string
}

export interface EngineReply {
  readonly status?: number
  readonly body?: unknown
  readonly raw?: string
  readonly contentType?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly hold?: boolean
}

export type EngineAnswer = (request: SentRequest) => EngineReply

export interface LoopbackEngine {
  readonly origin: string
  readonly requests: SentRequest[]
  close(): Promise<void>
}

const LOCALHOST = "127.0.0.1"
const FORM_TYPE = "application/x-www-form-urlencoded"

function contentTypeOf(answer: EngineReply): string | undefined {
  return answer.contentType ?? (answer.body === undefined ? undefined : "application/json")
}

function reply(res: ServerResponse, answer: EngineReply): void {
  const { status = 200, body, raw, headers, hold = false } = answer
  const contentType = contentTypeOf(answer)
  res.writeHead(status, "", { ...(contentType ? { "Content-Type": contentType } : {}), ...headers })
  const text = raw ?? (body === undefined ? "" : JSON.stringify(body))
  if (hold) {
    res.write(text)
    return
  }
  res.end(text)
}

function recorded(req: IncomingMessage, body: string): SentRequest {
  const { authorization, "content-type": contentType } = req.headers
  return {
    method: req.method ?? "",
    target: req.url ?? "",
    ...(authorization === undefined ? {} : { authorization }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(body === "" ? {} : { body }),
  }
}

function handler(answer: EngineAnswer, requests: SentRequest[]) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const request = recorded(req, Buffer.concat(chunks).toString("utf8"))
      requests.push(request)
      reply(res, answer(request))
    })
  }
}

async function listening(
  server: Server,
  scheme: string,
  requests: SentRequest[],
): Promise<LoopbackEngine> {
  server.listen(0, LOCALHOST)
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    origin: `${scheme}://${LOCALHOST}:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}

export function startEngine(answer: EngineAnswer): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  return listening(createServer(handler(answer, requests)), "http", requests)
}

export function startSilentEngine(): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  const server = createServer((req) => {
    requests.push(recorded(req, ""))
  })
  return listening(server, "http", requests)
}

export async function closedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, LOCALHOST)
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  return port
}

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
const time = (value: string) => der(0x17, Buffer.from(value))

function selfSigned(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const name = sequence(der(0x31, sequence(COMMON_NAME, der(0x0c, Buffer.from(LOCALHOST)))))
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
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${base64.replace(/.{64}/g, "$&\n")}\n-----END CERTIFICATE-----\n`,
  }
}

export function startTlsEngine(answer: EngineAnswer): Promise<LoopbackEngine> {
  const requests: SentRequest[] = []
  const server = createTlsServer(selfSigned(), handler(answer, requests))
  return listening(server, "https", requests)
}

export const UNRESOLVABLE_ORIGIN = "http://cluster.pulse-golden.invalid"

export function withoutPorts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")) as T
}

function lineOf({ method, target, authorization, contentType, body }: SentRequest): string {
  const sent =
    authorization === undefined ? `${method} ${target}` : `${method} ${target} [${authorization}]`
  return contentType?.startsWith(FORM_TYPE) === true ? `${sent} ${body ?? ""}` : sent
}

export function sentLines(requests: readonly SentRequest[], inArrivalOrder: boolean): string[] {
  const lines = requests.map(lineOf)
  return inArrivalOrder ? lines : lines.sort()
}
