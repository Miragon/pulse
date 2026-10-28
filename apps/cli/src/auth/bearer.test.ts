import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import { authDeps } from "../../test/support/auth-deps.js"
import type { StaticBearerConfig } from "../config/types.js"
import { PulseCliError } from "../errors.js"
import { compact } from "../util.js"
import { bearerAuth, claimText, renewal, tokenExpired } from "./bearer.js"
import { createAuthProvider } from "./index.js"

const NOW = NOW_S * 1000

type Overrides = { readonly [K in keyof StaticBearerConfig]?: StaticBearerConfig[K] | undefined }

function config(token: string, overrides: Overrides = {}): StaticBearerConfig {
  const merged = {
    type: "bearer",
    token,
    source: "env",
    origin: "PULSE_CLI_TOKEN",
    variable: "PULSE_CLI_TOKEN",
    ...overrides,
  }
  return compact(merged) as StaticBearerConfig
}

const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 })

describe("bearerAuth", () => {
  it("sends an opaque token as it is, without refresh, principal or note", async () => {
    const provider = bearerAuth(config("opaque-token"), () => NOW)
    expect(provider.type).toBe("bearer")
    await expect(provider.headers()).resolves.toEqual({ Authorization: "Bearer opaque-token" })
    await expect(provider.preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer opaque-token" },
    })
    expect("refresh" in provider).toBe(false)
    expect(provider.principal).toBeUndefined()
    expect(provider.off).toBeUndefined()
  })

  it("names the user of a JWT and where the token came from", () => {
    expect(bearerAuth(config(jwtWith(VALID_CLAIMS)), () => NOW).principal).toEqual({
      user: "alice",
      source: "PULSE_CLI_TOKEN",
    })
    expect(bearerAuth(config(jwtWith({ sub: "s-1" })), () => NOW).principal).toEqual({
      user: "s-1",
      source: "PULSE_CLI_TOKEN",
    })
    expect(bearerAuth(config(jwtWith({ exp: NOW_S })), () => NOW).principal).toBeUndefined()
  })

  it("sends a JWT until 30 s after its exp, then fails with TOKEN_EXPIRED before sending", async () => {
    let now = (NOW_S + 30) * 1000
    const token = jwtWith({ ...VALID_CLAIMS, exp: NOW_S })
    const provider = bearerAuth(config(token), () => now)
    await expect(provider.headers()).resolves.toEqual({ Authorization: `Bearer ${token}` })
    now += 1
    const error = await provider.headers().then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(PulseCliError)
    const expired = error as PulseCliError
    expect(expired.code).toBe("TOKEN_EXPIRED")
    expect(expired.exitCode).toBe(4)
    expect(expired.message).toBe(
      "The bearer token from PULSE_CLI_TOKEN expired at 2023-11-14T22:13:20.000Z",
    )
    expect(expired.details.hint).toBe(
      "pulse-cli never refreshes bearer tokens: the bearer token from PULSE_CLI_TOKEN expired at 2023-11-14T22:13:20.000Z; fetch a new one (e.g. with your identity provider's CLI) and set PULSE_CLI_TOKEN.",
    )
    expect(JSON.stringify(expired.details) + expired.message).not.toContain(token)
  })

  it("previews an expired JWT with a note instead of failing", async () => {
    const provider = bearerAuth(config(EXPIRED), () => NOW)
    await expect(provider.preview?.()).resolves.toEqual({
      headers: { Authorization: `Bearer ${EXPIRED}` },
      note: "The bearer token from PULSE_CLI_TOKEN expired at 2023-11-14T22:12:49.000Z: the request would fail with TOKEN_EXPIRED. Fetch a new one and set PULSE_CLI_TOKEN.",
    })
  })

  it("explains a 401 and a 403, with the claims of a JWT to check", () => {
    const opaque = bearerAuth(config("opaque"), () => NOW)
    expect(opaque.rejectedHint?.(401)).toBe(
      "Bearer auth failed: the engine rejected the bearer token from PULSE_CLI_TOKEN. Check that the token is still valid and was issued for this engine (or the gateway in front of it); fetch a new token (e.g. with your identity provider's CLI) and set PULSE_CLI_TOKEN. pulse-cli sends the token as it is and never refreshes it.",
    )
    const jwt = bearerAuth(config(jwtWith(VALID_CLAIMS)), () => NOW)
    expect(jwt.rejectedHint?.(401)).toBe(
      "Bearer auth failed: the engine rejected the bearer token from PULSE_CLI_TOKEN (a JWT: subject 27c6dbd7-a170-4b19-8686-f7299949346a, issuer https://login.example.com/realms/camunda, audience engine-rest account, expires at 2023-11-14T23:13:20.000Z). Check that the engine (or the gateway in front of it) expects its issuer and audience and trusts the key that signed it (pulse-cli checks no signatures); fetch a new token (e.g. with your identity provider's CLI) and set PULSE_CLI_TOKEN. pulse-cli sends the token as it is and never refreshes it.",
    )
    expect(jwt.rejectedHint?.(403)).toBe(
      "The engine (or the gateway in front of it) refused the bearer token from PULSE_CLI_TOKEN (a JWT: subject 27c6dbd7-a170-4b19-8686-f7299949346a, issuer https://login.example.com/realms/camunda, audience engine-rest account, expires at 2023-11-14T23:13:20.000Z): the token was accepted, but it lacks the roles or scopes this operation needs, or its user has no engine authorization for it. Request a token with the required roles or scopes (another scope or audience at the identity provider), or ask for the engine authorization.",
    )
    expect(opaque.rejectedHint?.(403)).toContain(
      "refused the bearer token from PULSE_CLI_TOKEN: the",
    )
    expect(jwt.rejectedHint?.(404)).toBeUndefined()
    expect(jwt.rejectedHint?.(500)).toBeUndefined()
    // a JWT without the claims of a hint lists none
    expect(bearerAuth(config(jwtWith({})), () => NOW).rejectedHint?.(401)).toContain(
      "rejected the bearer token from PULSE_CLI_TOKEN. Check that the engine",
    )
  })

  it("says that a JWT sent within the 30 s grace after its exp has expired", () => {
    const token = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 10 })
    let now = NOW - 10_000
    const provider = bearerAuth(config(token), () => now)
    // exactly at exp: expired for the hint, still sent (TOKEN_EXPIRED needs 30 s more)
    expect(provider.rejectedHint?.(401)).toContain(
      "audience engine-rest account, expired at 2023-11-14T22:13:10.000Z). It expired at 2023-11-14T22:13:10.000Z: pulse-cli still sends a JWT up to 30 s after its exp (clock skew), but the engine or its gateway no longer accepts it; fetch a new token",
    )
    expect(provider.rejectedHint?.(403)).toContain("expired at 2023-11-14T22:13:10.000Z)")
    now -= 1
    expect(provider.rejectedHint?.(401)).toContain(
      "expires at 2023-11-14T22:13:10.000Z). Check that the engine",
    )
  })
})

describe("renewal", () => {
  it("says how to supply a new token for each source", () => {
    expect(
      renewal(config("t", { source: "flag", origin: "--auth-token-stdin", variable: undefined })),
    ).toBe("pipe it into --auth-token-stdin")
    expect(renewal(config("t", { source: "profile", variable: "CI_TOKEN" }))).toBe("set CI_TOKEN")
    const stored = {
      source: "profile" as const,
      origin: 'auth.token of profile "p"',
      variable: undefined,
    }
    expect(renewal(config("t", { ...stored, profile: "p" }))).toBe(
      "set PULSE_CLI_TOKEN (it overrides the stored token) or store it with `pulse-cli config set p --auth-token-stdin`",
    )
    expect(renewal(config("t", stored))).toContain(
      "pulse-cli config set <profile> --auth-token-stdin",
    )
  })
})

describe("claimText and tokenExpired", () => {
  it("lists only the claims a JWT has", () => {
    expect(
      claimText(
        { expiresAt: null, subject: null, user: "u", issuer: "https://i", audience: [] },
        NOW,
      ),
    ).toBe("issuer https://i")
    expect(tokenExpired(config("t"), 0).message).toBe(
      "The bearer token from PULSE_CLI_TOKEN expired at 1970-01-01T00:00:00.000Z",
    )
  })
})

describe("createAuthProvider for bearer tokens", () => {
  it("uses the clock of the dependencies for the expiry check", async () => {
    const runtime = fakeRuntime()
    const provider = createAuthProvider(config(EXPIRED), authDeps(runtime))
    expect(provider.type).toBe("bearer")
    await expect(provider.headers()).rejects.toMatchObject({ code: "TOKEN_EXPIRED" })
  })
})
