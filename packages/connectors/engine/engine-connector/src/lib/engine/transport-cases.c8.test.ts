/**
 * TRANSPORT_CASES of @miragon/pulse-http through the server's Camunda 8 wire (c8-connection.ts),
 * called as c8-core's REST client calls its transport (a GET, a search as a POST that reads, a
 * diagram as text; the path values encoded into the path), against the package's loopback engine
 * of each case. What the model would read (the failure in c8-errors.ts's words, through c8-core's
 * C8Failures) is the observation's text. A renewing credential is the client credentials grant
 * against a token endpoint of the test's own, which issues the case's tokens in turn while the
 * clock moves past a young token's age with each request to the cluster.
 */
import { describe, expect, it } from "vitest"
import { C8Failures, type CamundaTransport } from "@miragon/pulse-c8-core"
import { HttpFailure, type Platform } from "@miragon/pulse-http"
import {
  type CaseCapability,
  type CaseConnection,
  caseFindings,
  casesFor,
  type Observed,
  pathOfCase,
  TRANSPORT_CASES,
  type TransportCase,
} from "@miragon/pulse-http/testing"
import { startCaseEngine } from "@miragon/pulse-http/testing/loopback"
import { type C8Auth, type C8Connection, createC8Connection } from "./c8-connection.js"
import { c8WordsOf } from "./c8-errors.js"

/**
 * What the server's Camunda 8 wire can express: Basic, a token the client credentials grant
 * renews, a read-only connection (every connection to a cluster is one) and a read the MCP
 * request cancels. A cluster gets no fixed bearer token and no caller's token, and the wire
 * sends no write.
 */
const SERVER_C8: readonly CaseCapability[] = ["basic", "renewal", "read-only", "cancel"]

const TOKEN_ENDPOINT = "http://token.c8-case.test/token"

/** Past the age of a young token, whose refusal earns no renewal (`EXPIRY.youngTokenMs`). */
const PAST_A_YOUNG_TOKEN_MS = 31_000

function authOf(connection: CaseConnection): C8Auth {
  const { credential } = connection
  switch (credential.type) {
    case "basic":
      return { type: "basic", username: credential.username, password: credential.password }
    case "renewable":
      return {
        type: "clientCredentials",
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "pulse-case",
        clientSecret: "case-secret",
      }
    default:
      return { type: "none" }
  }
}

interface Exchange {
  status?: number
}

/**
 * The real `fetch` to the case's engine, the status of its last answer noted; the case's tokens
 * from a token endpoint of its own, one per request; the clock past a young token's age with each
 * request to the engine.
 */
function platformOf(kase: TransportCase, exchange: Exchange): Platform {
  const { credential } = kase.connection
  const tokens = credential.type === "renewable" ? [...credential.tokens] : []
  let now = 1_000_000
  return {
    now: () => now,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url === TOKEN_ENDPOINT) {
        const issued = { access_token: tokens.shift(), token_type: "Bearer", expires_in: 3600 }
        return Response.json(issued)
      }
      now += PAST_A_YOUNG_TOKEN_MS
      const response = await fetch(input, init)
      exchange.status = response.status
      return response
    },
  }
}

/** The request of the case as c8-core's REST client would send it. */
function called(kase: TransportCase, transport: CamundaTransport): Promise<unknown> {
  const { request } = kase
  const path = pathOfCase(request, (value) => encodeURIComponent(value))
  if (request.body !== undefined) return transport.post(path, JSON.parse(request.body) as unknown)
  return request.expects === "json" ? transport.get(path) : transport.text(path)
}

/** A failure as the case reads it: the transport's reason, and what the model would read. */
function failed(error: unknown, transport: CamundaTransport, connection: C8Connection): Observed {
  if (!(error instanceof HttpFailure)) throw error
  const { message, hint } = new C8Failures(transport, c8WordsOf(connection)).errorOf(error)
  const { reason, status, mayHaveApplied } = error
  return {
    outcome: reason,
    ...(status === undefined ? {} : { status }),
    mayHaveApplied,
    text: [message, hint].join("\n"),
  }
}

async function observe(kase: TransportCase, origin: string): Promise<Observed> {
  const exchange: Exchange = {}
  const { connection } = kase
  const c8 = createC8Connection(
    { id: "case", baseUrl: `${origin}${connection.root}` },
    authOf(connection),
    {
      timeoutMs: connection.timeoutMs,
      ...(connection.maxAnswerBytes === undefined
        ? {}
        : { maxAnswerBytes: connection.maxAnswerBytes }),
    },
    platformOf(kase, exchange),
  )
  const { cancelAfterMs } = kase.request
  const transport = c8.transport(
    cancelAfterMs === undefined ? undefined : AbortSignal.timeout(cancelAfterMs),
  )
  try {
    const value = await called(kase, transport)
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null)
    return { outcome: "answered", ...exchange, text }
  } catch (error) {
    return failed(error, transport, c8)
  }
}

describe("the server's Camunda 8 wiring of the transport", () => {
  const expressed = casesFor(SERVER_C8).filter((kase) => kase.request.intent === "read")

  it("names the cases it leaves out: a write, a fixed bearer token, the caller's token", () => {
    const left = TRANSPORT_CASES.filter((kase) => !expressed.includes(kase))
    expect(left.filter((kase) => kase.request.intent === "write").length).toBeGreaterThan(0)
    expect(left.filter((kase) => kase.request.intent === "read").map((kase) => kase.name)).toEqual([
      "unauthorized-bearer",
      "unauthorized-passthrough",
      "engine-text-echoes-secret-bearer",
      "token-line-break-inside",
      "token-line-break-trailing",
    ])
  })

  it.each(expressed.map((kase) => [kase.name, kase] as const))("passes %s", async (_name, kase) => {
    const engine = await startCaseEngine(kase)
    try {
      const observed = await observe(kase, engine.origin)
      expect(caseFindings(kase, observed, engine.seen)).toEqual([])
    } finally {
      await engine.close()
    }
  })
})
