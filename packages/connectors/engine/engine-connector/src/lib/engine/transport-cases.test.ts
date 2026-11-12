/**
 * TRANSPORT_CASES of @miragon/pulse-http through the MCP server's wiring of the transport: the
 * module's engine client (`createEngineConnection`), called as the generated SDK calls it (the
 * path values through its requestValidator, the URL built and resolved by a Request, the intent
 * from c7-core's route table, the answer read by the SDK), against the package's loopback engine
 * of each case. What the model would read (the failure's message) is the observation's text.
 */
import { describe, expect, it } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { HttpFailure } from "@miragon/pulse-http"
import {
  type CaseCapability,
  type CaseCredential,
  caseFindings,
  casesFor,
  type Observed,
  TRANSPORT_CASES,
  type TransportCase,
} from "@miragon/pulse-http/testing"
import { startCaseEngine } from "@miragon/pulse-http/testing/loopback"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import type { EngineAuth } from "../../engine-provider.js"
import { createEngineConnection } from "./engine-connection.js"
import { EngineRequestError } from "./engine-error.js"

/**
 * What the server can express: Basic, a fixed bearer token, the caller's token passed through
 * and a read the MCP request cancels. No credential renews (the server signs in with what it is
 * configured with), and no engine is read-only yet.
 */
const SERVER: readonly CaseCapability[] = ["basic", "bearer", "passthrough", "cancel"]

function authOf(credential: CaseCredential): EngineAuth {
  switch (credential.type) {
    case "basic":
      return { type: "basic", username: credential.username, password: credential.password }
    case "bearer":
      return { type: "bearer", token: credential.token }
    case "caller":
      return { type: "passthrough" }
    default:
      return { type: "none" }
  }
}

/** A failure as the case reads it: the transport's reason where it gave one. */
function failed(error: unknown): Observed {
  if (!(error instanceof EngineRequestError)) throw error
  const text = [error.message, error.engineMessage].join("\n")
  if (error.cause instanceof HttpFailure) {
    const { reason, status, mayHaveApplied } = error.cause
    return { outcome: reason, ...(status === undefined ? {} : { status }), mayHaveApplied, text }
  }
  if (error.kind === "http") {
    const outcome = error.httpStatus === 401 ? "unauthorized" : "status"
    return {
      outcome,
      ...(error.httpStatus === undefined ? {} : { status: error.httpStatus }),
      mayHaveApplied: false,
      text,
    }
  }
  // The path value rule, before anything is built.
  return { outcome: "invalid-request", mayHaveApplied: false, text }
}

/** The SDK call of the case: its method, template, path values, JSON body and caller abort. */
async function called(kase: TransportCase, client: Client): Promise<Observed> {
  const { request } = kase
  const method = request.method.toLowerCase() as "get" | "post" | "put" | "delete"
  const result = (await client[method]({
    url: request.path,
    path: { ...request.values },
    ...(request.body === undefined ? {} : { body: JSON.parse(request.body) as unknown }),
    ...(request.cancelAfterMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(request.cancelAfterMs) }),
    parseAs: request.expects === "json" ? "json" : "text",
    responseStyle: "fields",
  })) as unknown as { data: unknown; response: Response }
  const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data)
  return { outcome: "answered", status: result.response.status, text }
}

async function observe(kase: TransportCase, origin: string): Promise<Observed> {
  const { connection } = kase
  let client: Client
  try {
    client = createEngineConnection(
      { id: "case", baseUrl: `${origin}${connection.root}` },
      authOf(connection.credential),
      {
        timeoutMs: connection.timeoutMs,
        ...(connection.maxAnswerBytes === undefined
          ? {}
          : { maxAnswerBytes: connection.maxAnswerBytes }),
      },
    )
  } catch (error) {
    // A credential no header can carry fails the boot.
    return { outcome: "credential", text: (error as Error).message }
  }
  const call = () => called(kase, client).catch(failed)
  const { credential } = connection
  return credential.type === "caller"
    ? runWithMcpRequestInfo({ authorization: `Bearer ${credential.token}` }, call)
    : call()
}

describe("the server's wiring of the transport", () => {
  it("names the cases it cannot express: a renewing credential, a read-only engine", () => {
    const left = TRANSPORT_CASES.filter((kase) => !casesFor(SERVER).includes(kase))
    expect(left.map((kase) => kase.name)).toEqual([
      "unauthorized-renewed",
      "unauthorized-after-the-one-retry",
      "unauthorized-renewed-write",
      "read-only-refuses-a-write",
      "read-only-sends-a-reading-post",
    ])
  })

  it.each(casesFor(SERVER).map((kase) => [kase.name, kase] as const))(
    "passes %s",
    async (_name, kase) => {
      const engine = await startCaseEngine(kase)
      try {
        const observed = await observe(kase, engine.origin)
        expect(caseFindings(kase, observed, engine.seen)).toEqual([])
      } finally {
        await engine.close()
      }
    },
  )
})
