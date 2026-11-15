import { HttpFailure, type FailureReason } from "@miragon/pulse-http"
import { TokenFailure, type TokenFailureKind } from "@miragon/pulse-http/oauth"
import { describe, expect, test } from "vitest"
import { TokenReasons } from "../../src/wire/token-reasons.js"
import { TOKEN_URL } from "../support/token-endpoint.js"

const MIB = 1024 * 1024

function sent(reason: FailureReason, limit: number): HttpFailure {
  return new HttpFailure(reason, {
    method: "POST",
    target: TOKEN_URL,
    mayHaveApplied: false,
    limit,
  })
}

function failed(kind: TokenFailureKind, cause?: unknown): TokenFailure {
  return new TokenFailure(kind, { url: TOKEN_URL }, cause)
}

describe("the reason of a failed token request", () => {
  test("carries the transport's cap when the token answer is too large", () => {
    const reason = TokenReasons.of(failed("too-large", sent("too-large", MIB)), TOKEN_URL)

    expect(reason).toMatchObject({ kind: "token", trouble: "too-large", capBytes: MIB })
  })

  test.each<[string, TokenFailure]>([
    ["a timeout, whose deadline is no size", failed("timeout", sent("deadline", 10_000))],
    ["an endpoint out of reach", failed("unreachable", sent("connection", 10_000))],
    ["an answer too large with no failure of the transport behind it", failed("too-large")],
  ])("carries no cap for %s", (_name, failure) => {
    const reason = TokenReasons.of(failure, TOKEN_URL)

    expect(reason.trouble).toBe(failure.kind)
    expect(reason.capBytes).toBeUndefined()
  })

  test("names the endpoint without its query, its fragment or a user", () => {
    const reason = TokenReasons.of(
      failed("unreachable"),
      "https://user:pass@login.test/oauth/token?tenant=t1#start",
    )

    expect(reason.endpoint).toBe(TOKEN_URL)
  })

  test("names an endpoint that is no URL as it is written", () => {
    expect(TokenReasons.of(failed("unreachable"), "").endpoint).toBe("")
  })
})
