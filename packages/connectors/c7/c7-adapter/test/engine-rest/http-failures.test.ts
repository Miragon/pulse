import {
  FAILURE_REASONS,
  type FailureDetails,
  type FailureReason,
  HttpFailure,
} from "@miragon/pulse-http"
import { describe, expect, test } from "vitest"
import { EngineRequestError, UnexpectedAnswerError } from "../../src/engine-rest/index.js"
import { HttpFailures } from "../../src/engine-rest/http/http-failures.js"

const TARGET = "https://engine.test/engine-rest/version"

const ANSWER = {
  status: 503,
  statusText: "Service Unavailable",
  contentType: "application/json",
  headers: {},
  body: new TextEncoder().encode(JSON.stringify({ type: "X", message: "busy" })),
}

const DETAILS: Readonly<Record<FailureReason, Partial<FailureDetails>>> = {
  unreachable: { code: "ECONNREFUSED" },
  dns: { code: "ENOTFOUND" },
  tls: { code: "CERT_HAS_EXPIRED" },
  deadline: { limit: 60_000 },
  cancelled: {},
  connection: { code: "UND_ERR_SOCKET" },
  "too-large": { limit: 67_108_864 },
  redirect: { status: 307 },
  unauthorized: { status: 401 },
  status: { status: 503, answer: ANSWER },
  "invalid-answer": { status: 200 },
  "invalid-request": { code: "dot-segment" },
  "refused-write": {},
  credential: { code: "token-syntax" },
}

interface Worded {
  readonly kind: string
  readonly message: string
  readonly hint?: string
}

const EXPECTED: Readonly<Record<FailureReason, Worded>> = {
  unreachable: { kind: "unanswered", message: `Cannot reach ${TARGET} (ECONNREFUSED)` },
  dns: {
    kind: "unanswered",
    message: `Cannot reach ${TARGET}: the host name does not resolve (ENOTFOUND)`,
    hint: "Check the host name in the engine URL.",
  },
  tls: {
    kind: "unanswered",
    message: `Cannot reach ${TARGET}: the TLS handshake failed (CERT_HAS_EXPIRED)`,
    hint: "Check that this computer trusts the engine's certificate and that the engine serves https at this URL.",
  },
  deadline: { kind: "unanswered", message: `${TARGET} did not answer within 60000 ms` },
  cancelled: { kind: "unanswered", message: `The call to ${TARGET} was cancelled` },
  connection: {
    kind: "unanswered",
    message: `The connection to ${TARGET} failed (UND_ERR_SOCKET)`,
    hint: "Check the network path to the engine, such as a proxy, a VPN or a firewall.",
  },
  "too-large": { kind: "unexpected", message: "the engine answered with more than 67108864 bytes" },
  redirect: { kind: "answered", message: "HTTP 307 Temporary Redirect" },
  unauthorized: { kind: "answered", message: "HTTP 401 Unauthorized" },
  status: { kind: "answered", message: "HTTP 503 Service Unavailable: busy" },
  "invalid-answer": { kind: "unexpected", message: "the engine answered no JSON" },
  "invalid-request": {
    kind: "refused",
    message: `GET ${TARGET} cannot be sent (dot-segment)`,
  },
  "refused-write": {
    kind: "readOnly",
    message: `Read-only. This connection only reads, so Pulse did not send GET ${TARGET}.`,
  },
  credential: { kind: "unusable", message: `The credentials for ${TARGET} cannot be sent` },
}

function wordedOf(error: unknown): Worded {
  if (error instanceof UnexpectedAnswerError) {
    return { kind: "unexpected", message: error.message }
  }
  if (!(error instanceof EngineRequestError)) {
    throw new Error(`neither engine error: ${String(error)}`)
  }
  return {
    kind: error.failure,
    message: error.message,
    ...(error.hint === undefined || error.failure === "answered" ? {} : { hint: error.hint }),
  }
}

describe("the transport's failures as the adapter words them", () => {
  test("cover every reason the transport gives", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...FAILURE_REASONS].sort())
  })

  test.each([...FAILURE_REASONS])("%s", (reason) => {
    const failure = new HttpFailure(reason, {
      method: "GET",
      target: TARGET,
      mayHaveApplied: false,
      ...DETAILS[reason],
    })
    expect(wordedOf(HttpFailures.errorOf(failure))).toEqual(EXPECTED[reason])
  })

  test.each([
    ["dot-segment", "refused"],
    ["empty-segment", "refused"],
    ["UND_ERR_INVALID_ARG", "unusable"],
    ["ERR_INVALID_HTTP_TOKEN", "unusable"],
    ["header", "unusable"],
    ["method", "unusable"],
    ["body", "unusable"],
    ["outside-root", "unusable"],
    ["not-a-url", "unusable"],
    [undefined, "unusable"],
  ])(
    "read a request the transport cannot send for %s as %s: only a path value no resource carries is missing",
    (code, kind) => {
      const failure = new HttpFailure("invalid-request", {
        method: "GET",
        target: TARGET,
        mayHaveApplied: false,
        ...(code === undefined ? {} : { code }),
      })
      const error = HttpFailures.errorOf(failure)
      expect(error).toMatchObject({
        failure: kind,
        message: `GET ${TARGET} cannot be sent${code === undefined ? "" : ` (${code})`}`,
      })
      expect(EngineRequestError.isMissingResource(error)).toBe(kind === "refused")
    },
  )

  test.each([...FAILURE_REASONS])(
    "read %s as a missing resource only for a path value no resource carries",
    (reason) => {
      const failure = new HttpFailure(reason, {
        method: "PUT",
        target: TARGET,
        mayHaveApplied: false,
        ...DETAILS[reason],
      })
      expect(EngineRequestError.isMissingResource(HttpFailures.errorOf(failure))).toBe(
        reason === "invalid-request",
      )
    },
  )

  test("pass on what is no failure of the transport", () => {
    const error = new RangeError("no")
    expect(HttpFailures.errorOf(error)).toBe(error)
  })
})
