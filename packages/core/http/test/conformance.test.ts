/**
 * TRANSPORT_CASES through the package's own reference wirings over Node's fetch, one recording
 * engine on loopback per case: `call` (what Pulse for VS Code's facades build on) and `asFetch`
 * as a generated SDK client calls it (what the MCP server's engine client does: its path values
 * through its requestValidator, the URL built and resolved by a Request, the answer read as JSON).
 */
import { describe, expect, it } from "vitest"
import {
  createHttp,
  CredentialError,
  decodeText,
  encodePathValue,
  type Http,
  HttpFailure,
  type HttpRequest,
  joinUrl,
  parseJson,
  PathValueError,
  pathValueProblem,
  stringifyJson,
} from "../src/index.js"
import {
  CASE_CAPABILITIES,
  caseFindings,
  casesFor,
  credentialOfCase,
  type Observed,
  pathOfCase,
  TRANSPORT_CASES,
  type TransportCase,
} from "../src/testing/index.js"
import { startCaseEngine } from "../src/testing/loopback/index.js"

/** What a refusal before sending is, in the case's terms. */
function refused(error: unknown): Observed | undefined {
  if (error instanceof CredentialError) return { outcome: "credential", text: error.message }
  if (error instanceof PathValueError)
    return { outcome: "invalid-request", mayHaveApplied: false, text: error.message }
  return undefined
}

function failed(error: unknown): Observed {
  const early = refused(error)
  if (early !== undefined) return early
  if (!(error instanceof HttpFailure)) throw error
  const answer = error.answer === undefined ? "" : decodeText(error.answer)
  const details = JSON.stringify({
    location: error.location,
    problem: error.problem,
    code: error.code,
  })
  return {
    outcome: error.reason,
    ...(error.status === undefined ? {} : { status: error.status }),
    mayHaveApplied: error.mayHaveApplied,
    text: [error.message, details, answer].join("\n"),
  }
}

/** The caller's abort of a case that has one, from the moment it sends. */
const callerSignal = (kase: TransportCase) =>
  kase.request.cancelAfterMs === undefined
    ? {}
    : { signal: AbortSignal.timeout(kase.request.cancelAfterMs) }

function httpOf(kase: TransportCase, origin: string): Http {
  const { connection } = kase
  return createHttp(
    {
      url: `${origin}${connection.root}`,
      credential: credentialOfCase(connection.credential),
      timeoutMs: connection.timeoutMs,
      ...(connection.maxAnswerBytes === undefined
        ? {}
        : { maxAnswerBytes: connection.maxAnswerBytes }),
      ...(connection.readOnly === undefined ? {} : { readOnly: connection.readOnly }),
    },
    { fetch: globalThis.fetch, now: Date.now },
  )
}

const jsonBody = (kase: TransportCase) =>
  kase.request.body === undefined
    ? {}
    : { body: kase.request.body, headers: { "Content-Type": "application/json" } }

function requestOf(kase: TransportCase, http: Http): HttpRequest {
  const { request } = kase
  const url = joinUrl(http.root, pathOfCase(request, encodePathValue))
  return { method: request.method, url, intent: request.intent, ...jsonBody(kase) }
}

/** The answer's text as the wiring shows it: JSON re-written without losing a digit. */
const shown = (text: string, contentType: string) =>
  contentType.includes("json") && text !== "" ? (stringifyJson(parseJson(text, "raw")) ?? "") : text

/**
 * What a generated SDK's requestValidator does over its path values before it builds the URL
 * (the MCP server's engine client): the path value rule, since the Request resolves `.` and `..`.
 */
function validatePathValues(kase: TransportCase): void {
  for (const value of Object.values(kase.request.values ?? {})) {
    const problem = pathValueProblem(value)
    if (problem !== undefined) throw new PathValueError(problem)
  }
}

/** An answer below 400 as a generated SDK reads it: as JSON (`response.json()`) when expected. */
async function answered(kase: TransportCase, response: Response): Promise<Observed> {
  const { status } = response
  if (kase.request.expects !== "json") {
    return { outcome: "answered", status, text: await response.text() }
  }
  try {
    const value: unknown = await response.json()
    return { outcome: "answered", status, text: stringifyJson(value) ?? "" }
  } catch {
    return { outcome: "invalid-answer", mayHaveApplied: kase.request.intent !== "read", text: "" }
  }
}

const WIRINGS = {
  /** `call`: a status from 400 on fails. */
  call: async (kase: TransportCase, origin: string): Promise<Observed> => {
    try {
      const http = httpOf(kase, origin)
      const request = { ...requestOf(kase, http), ...callerSignal(kase) }
      if (kase.request.expects === "json") {
        const value = await http.json(request, "raw")
        return { outcome: "answered", status: 200, text: stringifyJson(value) ?? "" }
      }
      const answer = await http.call(request)
      return {
        outcome: "answered",
        status: answer.status,
        text: shown(decodeText(answer), answer.contentType),
      }
    } catch (error) {
      return failed(error)
    }
  },
  /**
   * `asFetch` as hey-api calls it: the path values checked, then each serialized with
   * encodeURIComponent, the URL resolved by a Request, integers beyond 2^53 as strings (the
   * server's choice), the answer read as JSON.
   */
  asFetch: async (kase: TransportCase, origin: string): Promise<Observed> => {
    try {
      const http = httpOf(kase, origin)
      validatePathValues(kase)
      const url = joinUrl(http.root, pathOfCase(kase.request, encodeURIComponent))
      const fetch = http.asFetch({ intentOf: () => kase.request.intent, integers: "string" })
      const { headers = {}, ...body } = jsonBody(kase)
      const init = { method: kase.request.method, headers, ...body, ...callerSignal(kase) }
      const response = await fetch(new Request(url, init))
      if (response.status < 400) return await answered(kase, response)
      const outcome = response.status === 401 ? "unauthorized" : "status"
      return {
        outcome,
        status: response.status,
        mayHaveApplied: false,
        text: await response.text(),
      }
    } catch (error) {
      return failed(error)
    }
  },
}

describe("the reference wirings express every case", () => {
  it("so they run all of them", () => {
    expect(casesFor(CASE_CAPABILITIES)).toEqual(TRANSPORT_CASES)
  })
})

describe.each(Object.entries(WIRINGS))(
  "TRANSPORT_CASES through %s over Node's fetch",
  (_, observe) => {
    it.each(casesFor(CASE_CAPABILITIES).map((kase) => [kase.name, kase] as const))(
      "%s",
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
  },
)
