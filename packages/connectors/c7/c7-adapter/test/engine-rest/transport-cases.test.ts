import { HttpFailure } from "@miragon/pulse-http"
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
import { describe, expect, test, vi } from "vitest"
import {
  EngineHttp,
  EngineRequestError,
  LosslessJson,
  UnexpectedAnswerError,
} from "../../src/engine-rest/index.js"
import type { EngineCredentials } from "../../src/engine-rest/http/engine-wire.js"
import { RequestArguments } from "../../src/engine-rest/request-arguments.js"

const ADAPTER: readonly CaseCapability[] = ["basic", "read-only"]

const ADAPTER_DEADLINE_MS = 60_000
const CAP = "the adapter's cap is 64 MiB on every connection; its golden too-large-response pins it"
const NO_WRITE_CAVEAT =
  "the adapter reports no write caveat: a write it cannot confirm reads as unreachable or unexpected, which the runtime view takes as an open outcome of a bulk write"

const DECIDED_OTHERWISE: Readonly<Record<string, string>> = {
  "deadline-exceeded-write": NO_WRITE_CAVEAT,
  "connection-reset-write": NO_WRITE_CAVEAT,
  "invalid-answer-write": NO_WRITE_CAVEAT,
  "too-large-response": CAP,
  "too-large-announced": CAP,
  "too-large-write": CAP,
}

interface Exchange {
  status?: number
}

function credentialsOf(connection: CaseConnection): EngineCredentials {
  const { credential } = connection
  return credential.type === "basic"
    ? { kind: "basic", username: credential.username, password: credential.password }
    : { kind: "none" }
}

function ownOutcome(error: unknown): Pick<Observed, "outcome" | "status"> {
  if (error instanceof UnexpectedAnswerError) {
    return { outcome: "invalid-answer" }
  }
  if (!(error instanceof EngineRequestError)) {
    throw error
  }
  if (error.status !== undefined) {
    return { outcome: error.status === 401 ? "unauthorized" : "status", status: error.status }
  }
  if (error.failure !== "refused") {
    throw error
  }
  return { outcome: "invalid-request" }
}

function outcomeOf(error: Error): Pick<Observed, "outcome" | "status"> {
  if (error.cause instanceof HttpFailure) {
    const { reason, status } = error.cause
    return { outcome: reason, ...(status === undefined ? {} : { status }) }
  }
  return ownOutcome(error)
}

function failed(error: unknown): Observed {
  if (!(error instanceof Error)) {
    throw error
  }
  const engineType = error instanceof EngineRequestError ? error.engineType : undefined
  const text = [error.message, engineType].join("\n")
  return { ...outcomeOf(error), mayHaveApplied: false, text }
}

async function withCaseDeadline<T>(kase: TransportCase, attempt: () => Promise<T>): Promise<T> {
  const setTimer = globalThis.setTimeout
  const timers = vi.spyOn(globalThis, "setTimeout")
  timers.mockImplementation((handler, delay, ...args) =>
    setTimer(handler, delay === ADAPTER_DEADLINE_MS ? kase.connection.timeoutMs : delay, ...args),
  )
  try {
    return await attempt()
  } finally {
    timers.mockRestore()
  }
}

async function called(kase: TransportCase, http: EngineHttp): Promise<unknown> {
  const { request } = kase
  const path = pathOfCase(request, (value) => RequestArguments.segment(value))
  if (request.intent === "write") {
    if (request.method === "GET") {
      throw new Error(`${kase.name} writes with a GET`)
    }
    return http.write(request.method, path, request.body)
  }
  const body = request.body === undefined ? undefined : (JSON.parse(request.body) as unknown)
  if (request.expects === "json" || body !== undefined) {
    return http.read(path, {}, body)
  }
  return http.text(path)
}

async function observe(kase: TransportCase, origin: string): Promise<Observed> {
  const { connection } = kase
  const exchange: Exchange = {}
  const http = new EngineHttp({
    url: `${origin}${connection.root}`,
    credentials: credentialsOf(connection),
    writes: connection.readOnly !== true,
    send: async (input, init) => {
      const response = await fetch(input, init)
      exchange.status = response.status
      return response
    },
  })
  try {
    const value = await withCaseDeadline(kase, () => called(kase, http))
    const text = typeof value === "string" ? value : LosslessJson.stringify(value ?? null)
    return { outcome: "answered", ...exchange, text }
  } catch (error: unknown) {
    return failed(error)
  }
}

describe("the C7 adapter's wiring of the transport", () => {
  const expressed = casesFor(ADAPTER).filter((kase) => !Object.hasOwn(DECIDED_OTHERWISE, kase.name))

  test("names the cases it leaves out: a token, a caller's abort, its fixed cap, a write caveat", () => {
    const left = TRANSPORT_CASES.filter((kase) => !expressed.includes(kase))
    expect(left.map((kase) => kase.name)).toEqual([
      "deadline-exceeded-write",
      "cancelled-by-the-caller",
      "cancel-of-a-write-ignored",
      "connection-reset-write",
      "too-large-response",
      "too-large-announced",
      "too-large-write",
      "unauthorized-bearer",
      "unauthorized-passthrough",
      "unauthorized-renewed",
      "unauthorized-after-the-one-retry",
      "unauthorized-renewed-write",
      "engine-text-echoes-secret-bearer",
      "token-line-break-inside",
      "token-line-break-trailing",
      "invalid-answer-write",
    ])
  })

  test.each(expressed.map((kase) => [kase.name, kase] as const))(
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
