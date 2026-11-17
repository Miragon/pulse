import { once } from "node:events"
import http from "node:http"
import type { AddressInfo } from "node:net"

/**
 * A loopback Camunda 8 cluster and its token endpoint for the server's Camunda 8 tests: real
 * sockets behind the real boot, each recording every request as it reached the socket (its
 * method, raw target, Authorization, content type and body), so a test counts what the server
 * sent to either. The cluster answers through an `EngineAnswer`, `clusterWorld`
 * (c8-cluster-world.ts) by default; the token endpoint issues a bearer token of the client
 * credentials grant to every request. The shapes are the C8 adapter's loopback engine's
 * (packages/connectors/c8/c8-adapter/test/goldens/loopback-engine.ts), as far as the world reads
 * them, so the world is a copy of its world below the header: apps share no code.
 */

export interface SentRequest {
  readonly method: string
  readonly target: string
  readonly authorization?: string
  readonly contentType?: string
  readonly body?: string
}

/** An answer: its status (200), its body as JSON, its content type (application/json). */
export interface EngineReply {
  readonly status?: number
  readonly body?: unknown
  readonly contentType?: string
}

export type EngineAnswer = (request: SentRequest) => EngineReply

/** One loopback server and every request it took. */
export interface LoopbackServer {
  /** `http://127.0.0.1:<port>`: the cluster's REST root is `${origin}/v2`. */
  readonly origin: string
  readonly requests: SentRequest[]
  close(): Promise<void>
}

/** The token every grant gets: the cluster's world reads no token, it only counts the request. */
export const ISSUED_TOKEN = "c8-access-token"

function reply(res: http.ServerResponse, { status = 200, body, contentType }: EngineReply): void {
  res.writeHead(status, "", { "Content-Type": contentType ?? "application/json" })
  res.end(JSON.stringify(body))
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

async function listening(answer: EngineAnswer): Promise<LoopbackServer> {
  const requests: SentRequest[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const request = recorded(req, Buffer.concat(chunks).toString("utf8"))
      requests.push(request)
      reply(res, answer(request))
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
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
  const [cluster, tokenEndpoint] = await Promise.all([listening(answer), listening(issueToken)])
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
