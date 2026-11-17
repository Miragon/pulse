import { UnexpectedAnswerError } from "@miragon/pulse-c8-core"
import { CredentialError, HttpFailure } from "@miragon/pulse-http"
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
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test, vi } from "vitest"
import { CamundaHttp } from "../../src/rest/camunda-http.js"
import { CamundaRequestError } from "../../src/rest/camunda-request-error.js"
import { CamundaWire } from "../../src/wire/camunda-wire.js"
import { ClientCredentialsSources } from "../../src/wire/client-credentials-sources.js"
import type { WirePlatform } from "../../src/wire/wire-platform.js"

const ADAPTER: readonly CaseCapability[] = ["basic", "read-only"]

const ADAPTER_DEADLINE_MS = 60_000
const CAP = "the adapter's cap is 64 MiB on every connection"

const DECIDED_OTHERWISE: Readonly<Record<string, string>> = {
  "too-large-response": CAP,
  "too-large-announced": CAP,
}

const PLATFORM: WirePlatform = {
  send: (input, init) => fetch(input, init),
  now: () => Date.now(),
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

function ownOutcome(error: Error): Pick<Observed, "outcome" | "status"> {
  if (error instanceof UnexpectedAnswerError) {
    return { outcome: "invalid-answer" }
  }
  if (error.cause instanceof CredentialError) {
    return { outcome: "credential" }
  }
  if (!(error instanceof CamundaRequestError) || error.status === undefined) {
    throw error
  }
  return { outcome: error.status === 401 ? "unauthorized" : "status", status: error.status }
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
  const hint = error instanceof CamundaRequestError ? error.hint : undefined
  return { ...outcomeOf(error), mayHaveApplied: false, text: [error.message, hint].join("\n") }
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

function called(kase: TransportCase, http: CamundaHttp): Promise<unknown> {
  const { request } = kase
  const path = pathOfCase(request, (value) => encodeURIComponent(value))
  if (request.body !== undefined) {
    return http.post(path, JSON.parse(request.body) as unknown)
  }
  return request.expects === "json" ? http.get(path) : http.text(path)
}

function httpOf(kase: TransportCase, origin: string, exchange: Exchange): CamundaHttp {
  const platform: WirePlatform = {
    ...PLATFORM,
    send: async (input, init) => {
      const response = await fetch(input, init)
      exchange.status = response.status
      return response
    },
  }
  const connection = {
    endpoint: `${origin}${kase.connection.root}`,
    credentials: credentialsOf(kase.connection),
  }
  const sources = new ClientCredentialsSources(platform)
  return new CamundaHttp(CamundaWire.of(connection, sources, platform))
}

async function observe(kase: TransportCase, origin: string): Promise<Observed> {
  const exchange: Exchange = {}
  const http = httpOf(kase, origin, exchange)
  try {
    const value = await withCaseDeadline(kase, () => called(kase, http))
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null)
    return { outcome: "answered", ...exchange, text }
  } catch (error: unknown) {
    return failed(error)
  }
}

describe("the C8 adapter's wiring of the transport", () => {
  const expressed = casesFor(ADAPTER).filter(
    (kase) => kase.request.intent === "read" && !Object.hasOwn(DECIDED_OTHERWISE, kase.name),
  )

  test("names the cases it leaves out: a write, a token, a caller's abort, its fixed cap", () => {
    const left = TRANSPORT_CASES.filter((kase) => !expressed.includes(kase))
    expect(left.filter((kase) => kase.request.intent === "write").length).toBeGreaterThan(0)
    expect(left.filter((kase) => kase.request.intent === "read").map((kase) => kase.name)).toEqual([
      "cancelled-by-the-caller",
      "too-large-response",
      "too-large-announced",
      "unauthorized-bearer",
      "unauthorized-passthrough",
      "unauthorized-renewed",
      "unauthorized-after-the-one-retry",
      "engine-text-echoes-secret-bearer",
      "token-line-break-inside",
      "token-line-break-trailing",
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
