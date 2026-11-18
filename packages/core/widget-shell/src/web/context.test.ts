import { TokenFailure } from "@miragon/pulse-http/oauth"
import { describe, expect, it } from "vitest"
import { passesBy } from "./context.js"

describe("passesBy: a provider that cannot answer now", () => {
  it("passes no answer, a 5xx and a limit by the failure's kind", () => {
    for (const kind of ["unavailable", "unreachable", "timeout", "rate-limited"] as const) {
      expect(passesBy(new TokenFailure(kind)), kind).toBe(true)
    }
  })

  it("passes an answer whose OAuth error code says the provider cannot answer now", () => {
    for (const error of ["temporarily_unavailable", "server_error"]) {
      expect(passesBy(new TokenFailure("grant", { status: 400, error })), error).toBe(true)
    }
  })

  it("passes no refusal, and nothing else", () => {
    expect(passesBy(new TokenFailure("grant", { status: 400, error: "invalid_grant" }))).toBe(false)
    expect(passesBy(new TokenFailure("client", { status: 401 }))).toBe(false)
    expect(passesBy(new RangeError("the authorization server URL is no absolute URL"))).toBe(false)
  })
})
