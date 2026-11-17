import { once } from "node:events"
import http from "node:http"
import https from "node:https"
import type { AddressInfo } from "node:net"
import { selfSigned } from "./fake-engines.js"

/**
 * A loopback Camunda 8 cluster and its token endpoint for the server's Camunda 8 tests: real
 * sockets behind the real boot, each recording every request as it reached the socket (its
 * method, raw target, Authorization, content type and body), so a test counts what the server
 * sent to either. The cluster answers through an `EngineAnswer`, `clusterWorld`
 * (c8-cluster-world.ts) by default; the token endpoint issues a bearer token of the client
 * credentials grant to every request. The shapes are the C8 adapter's loopback engine's
 * (packages/connectors/c8/c8-adapter/test/goldens/loopback-engine.ts), so the world and the
 * error-path cases are copies of its world and cases below their headers: apps share no code.
 * The error-path goldens start one engine for both (`startC8Engine`), the token endpoint at
 * Keycloak's path on the cluster's origin, as the adapter's goldens do, and the engines that never
 * answer or answer only over TLS (`startSilentC8Engine`, `startTlsC8Engine`).
 */

export interface SentRequest {
  readonly method: string
  readonly target: string
  readonly authorization?: string
  readonly contentType?: string
  readonly body?: string
}

/**
 * An answer: its status (200), its body as JSON or a `raw` text byte for byte, its content type
 * (application/json for a body, none for a raw text), headers of its own, and `hold`: the head and
 * the text go out, the answer never ends.
 */
export interface EngineReply {
  readonly status?: number
  readonly body?: unknown
  readonly raw?: string
  readonly contentType?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly hold?: boolean
}

export type EngineAnswer = (request: SentRequest) => EngineReply

/** One loopback server and every request it took. */
export interface LoopbackServer {
  /** `http(s)://127.0.0.1:<port>`: the cluster's REST root is `${origin}/v2`. */
  readonly origin: string
  readonly requests: SentRequest[]
  close(): Promise<void>
}

/** The token every grant gets: the cluster's world reads no token, it only counts the request. */
export const ISSUED_TOKEN = "c8-access-token"

const FORM_TYPE = "application/x-www-form-urlencoded"

function reply(res: http.ServerResponse, answer: EngineReply): void {
  const { status = 200, body, raw, headers, hold = false } = answer
  const contentType = answer.contentType ?? (body === undefined ? undefined : "application/json")
  res.writeHead(status, "", { ...(contentType ? { "Content-Type": contentType } : {}), ...headers })
  const text = raw ?? (body === undefined ? "" : JSON.stringify(body))
  if (hold) {
    res.write(text)
    return
  }
  res.end(text)
}

/** A request as it reached the socket; a Node server always has a method and a URL. */
function recorded(req: http.IncomingMessage, body: string): SentRequest {
  const { authorization, "content-type": contentType } = req.headers
  return {
    method: String(req.method),
    target: String(req.url),
    ...(authorization === undefined ? {} : { authorization }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(body === "" ? {} : { body }),
  }
}

function handler(answer: EngineAnswer, requests: SentRequest[]): http.RequestListener {
  return (req, res) => {
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
  server: http.Server,
  scheme: string,
  requests: SentRequest[],
): Promise<LoopbackServer> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    origin: `${scheme}://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

/** One plain HTTP engine answering through `answer`: a cluster, a token endpoint, or both. */
export function startC8Engine(answer: EngineAnswer): Promise<LoopbackServer> {
  const requests: SentRequest[] = []
  return listening(http.createServer(handler(answer, requests)), "http", requests)
}

/** An engine that takes every request and never answers: only a deadline ends the call. */
export function startSilentC8Engine(): Promise<LoopbackServer> {
  const requests: SentRequest[] = []
  const server = http.createServer((req) => {
    requests.push(recorded(req, ""))
  })
  return listening(server, "http", requests)
}

/** An HTTPS engine behind a self-signed certificate: the TLS handshake fails before any request. */
export function startTlsC8Engine(answer: EngineAnswer): Promise<LoopbackServer> {
  const requests: SentRequest[] = []
  return listening(https.createServer(selfSigned(), handler(answer, requests)), "https", requests)
}

function lineOf({ method, target, authorization, contentType, body }: SentRequest): string {
  const sent =
    authorization === undefined ? `${method} ${target}` : `${method} ${target} [${authorization}]`
  return contentType?.startsWith(FORM_TYPE) === true ? `${sent} ${body ?? ""}` : sent
}

/**
 * The requests an engine saw as `METHOD target [Authorization]`, a token request with its form: in
 * arrival order up to the last read of the cluster's version, whose requests go out one after
 * another (a token, the version, a renewed token, the version again), then sorted, since the
 * reads after the version run in parallel and arrive in any order.
 */
export function c8SentLines(requests: readonly SentRequest[]): string[] {
  const lines = requests.map(lineOf)
  const versions = requests.map((request, index) =>
    request.target.endsWith("/topology") ? index : -1,
  )
  const head = Math.max(-1, ...versions) + 1
  return [...lines.slice(0, head), ...lines.slice(head).sort()]
}

/** A token endpoint of the client credentials grant: a bearer token for five minutes to anyone. */
const issueToken: EngineAnswer = () => ({
  body: { access_token: ISSUED_TOKEN, token_type: "Bearer", expires_in: 300 },
})

/** A Camunda 8 cluster answering through `answer`, and the token endpoint it trusts. */
export interface FakeC8Cluster {
  readonly cluster: LoopbackServer
  readonly tokenEndpoint: LoopbackServer
  /** A profile of the client credentials grant for both, its secret in `secretVariable`. */
  profile(secretVariable: string): Record<string, unknown>
  /** Every request either has taken, in the order each took them. */
  sent(): SentRequest[]
  close(): Promise<void>
}

export async function startC8Cluster(answer: EngineAnswer): Promise<FakeC8Cluster> {
  const [cluster, tokenEndpoint] = await Promise.all([
    startC8Engine(answer),
    startC8Engine(issueToken),
  ])
  return {
    cluster,
    tokenEndpoint,
    profile: (secretVariable) => ({
      url: `${cluster.origin}/v2`,
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: `${tokenEndpoint.origin}/realms/pulse/protocol/openid-connect/token`,
        clientId: "pulse",
        clientSecretEnv: secretVariable,
      },
    }),
    sent: () => [...tokenEndpoint.requests, ...cluster.requests],
    close: async () => {
      await Promise.all([cluster.close(), tokenEndpoint.close()])
    },
  }
}
