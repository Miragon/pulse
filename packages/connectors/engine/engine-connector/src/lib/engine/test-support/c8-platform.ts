/**
 * A Camunda 8 cluster and its token endpoint in a `fetch` of their own, for the tests of the
 * server's Camunda 8 wire (c8-connection.ts, c8-errors.ts): each request answered by its method
 * and path, recorded as it was sent, and a clock the test moves. The transport's conformance cases
 * run the wire against real sockets instead (transport-cases.c8.test.ts).
 */
import type { Platform } from "@miragon/pulse-http"

export const CLUSTER = "https://cluster.c8.test/v2"
export const TOKEN_ENDPOINT = "https://login.c8.test/realms/pulse/token"

interface SentRequest {
  readonly method: string
  /** The path below the origin, its query included. */
  readonly path: string
  readonly headers: Headers
  readonly body: string
  readonly signal: AbortSignal | undefined
}

/** One answer, by the request; one that never settles hangs until the request aborts. */
export type Answer = (request: SentRequest) => Response | Promise<Response>

export interface C8Platform extends Platform {
  readonly sent: SentRequest[]
  /** The clock `now` reads, in ms. */
  ms: number
}

/** A JSON answer. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })

/** An RFC 9457 problem, as a Camunda 8 cluster states one. */
export const problem = (status: number, title: string, detail: string) =>
  new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  })

/** A token of the client credentials grant. */
export const token = (accessToken: string) =>
  json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 })

/** Never answers; rejects with the request's abort. */
export const hang: Answer = ({ signal }) =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(signal.reason as Error)
    })
  })

/** A connection refused before anything was sent. */
export const refused: Answer = () =>
  Promise.reject(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    }),
  )

/**
 * A platform whose `fetch` answers `"<METHOD> <path>"` by `answers` (the path below the origin,
 * without the query), anything else with a 404 problem.
 */
export function c8Platform(answers: Readonly<Record<string, Answer>>): C8Platform {
  const sent: SentRequest[] = []
  const platform: C8Platform = {
    sent,
    ms: 1_000_000,
    now: () => platform.ms,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const body = init?.body
      const request: SentRequest = {
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        headers: new Headers(init?.headers),
        body:
          typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : "",
        signal: init?.signal ?? undefined,
      }
      sent.push(request)
      const answer = answers[`${request.method} ${url.pathname}`]
      return answer === undefined
        ? problem(404, "NOT_FOUND", `No route ${request.method} ${url.pathname}`)
        : answer(request)
    },
  }
  return platform
}
