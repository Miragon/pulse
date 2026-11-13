/**
 * The CLI's token requests over @miragon/pulse-http/oauth: how the client maps onto the token
 * endpoint, what goes into the --verbose trace and every message of a failed request. The wire,
 * the client authentication and the checks of a token answer are the package's, tested there
 * (packages/core/http/test/oauth).
 */
import { describe, expect, it } from "vitest"
import { connectionRefused } from "../../../test/support/fake-fetch.js"
import { fakeIdp, jwt, oauthError, tokenJson } from "../../../test/support/fake-idp.js"
import { fakeRuntime } from "../../../test/support/fake-runtime.js"
import { oauthDeps, TOKEN_ENDPOINT } from "../../../test/support/oauth.js"
import { PulseCliError } from "../../errors.js"
import type { TraceEvent } from "../../http/types.js"
import { sanitize, statusLine } from "./http.js"
import {
  exchangeCode,
  idTokenClaims,
  refreshTokens,
  revokeToken,
  type TokenClient,
} from "./token.js"

const PUBLIC: TokenClient = {
  clientId: "pulse-cli",
  method: "client_secret_basic",
  endpoint: { url: TOKEN_ENDPOINT, source: 'auth.issuer of profile "p"' },
  who: { profile: "p" },
}
const CODE = {
  code: "c-1",
  redirectUri: "http://127.0.0.1:5000/callback",
  verifier: "v".repeat(43),
}
const HINT =
  "Run `pulse auth login --profile p` in a terminal: a person logs in once in the browser, pulse refreshes the token afterwards. Agents cannot log in themselves."

async function rejection(promise: Promise<unknown>): Promise<PulseCliError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    return error as PulseCliError
  }
  throw new Error("expected an error")
}

function capture(
  answer: Response | Error = tokenJson({ access_token: "a", token_type: "Bearer" }),
) {
  const calls: { url: string; init: RequestInit }[] = []
  const events: TraceEvent[] = []
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof input === "string" ? input : "unexpected", init: init ?? {} })
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone())
  }
  return { calls, events, deps: oauthDeps(fakeRuntime({ fetch }), { events }) }
}

function formOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(typeof init.body === "string" ? init.body : ""))
}

/** The error a refresh (or a code exchange) gets for `answer`. */
function refusal(answer: Response, grant: "refresh" | "exchange" = "refresh") {
  const { deps } = capture(answer)
  return rejection(
    grant === "refresh" ? refreshTokens(PUBLIC, "r", deps) : exchangeCode(PUBLIC, CODE, deps),
  )
}

describe("token requests", () => {
  it("exchange the code with the verifier and the redirect URI as sent, traced", async () => {
    const { calls, events, deps } = capture()
    const tokens = await exchangeCode(PUBLIC, CODE, deps)
    expect(tokens).toEqual({
      accessToken: "a",
      receivedAt: deps.now(),
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
      scope: null,
      subject: null,
      user: null,
    })
    expect(calls[0]?.url).toBe(TOKEN_ENDPOINT)
    expect(calls[0]?.init).toMatchObject({ method: "POST", redirect: "manual" })
    expect(formOf(calls[0]!.init)).toEqual({
      grant_type: "authorization_code",
      code: "c-1",
      redirect_uri: "http://127.0.0.1:5000/callback",
      code_verifier: "v".repeat(43),
      client_id: "pulse-cli",
    })
    expect(events.map((event) => event.type)).toEqual(["request", "response"])
    expect(events[0]).toMatchObject({ method: "POST", url: TOKEN_ENDPOINT })
  })

  it("refresh without a scope; mask the client credentials in the trace", async () => {
    const { calls, events, deps } = capture()
    await refreshTokens({ ...PUBLIC, clientSecret: "top-secret" }, "r-1", deps)
    expect(formOf(calls[0]!.init)).toEqual({ grant_type: "refresh_token", refresh_token: "r-1" })
    const sent = new Headers(calls[0]?.init.headers).get("authorization")
    expect(sent).toBe(`Basic ${btoa("pulse-cli:top-secret")}`)
    expect(events[0]).toMatchObject({
      type: "request",
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic ***",
      },
    })
    expect(events[1]).toMatchObject({ type: "response", status: 200, statusText: "OK" })
    expect(JSON.stringify(events)).not.toContain("r-1")
    expect(JSON.stringify(events)).not.toContain("top-secret")
  })

  it("put id and secret into the form for client_secret_post", async () => {
    const { calls, deps } = capture()
    const client = { ...PUBLIC, clientSecret: "s:1", method: "client_secret_post" as const }
    await refreshTokens(client, "r-1", deps)
    expect(new Headers(calls[0]?.init.headers).has("authorization")).toBe(false)
    expect(formOf(calls[0]!.init)).toMatchObject({ client_id: "pulse-cli", client_secret: "s:1" })
  })

  it("keep the display values of the ID token, the lifetimes from the receipt", async () => {
    const answer = tokenJson({
      access_token: "a",
      expires_in: 300,
      refresh_token: "r",
      refresh_expires_in: "1800",
      scope: "openid",
      id_token: jwt({ sub: "s-1", preferred_username: "alice" }),
    })
    const { deps } = capture(answer)
    const now = deps.now()
    await expect(refreshTokens(PUBLIC, "r", deps)).resolves.toEqual({
      accessToken: "a",
      receivedAt: now,
      expiresAt: now + 300_000,
      refreshToken: "r",
      refreshExpiresAt: now + 1_800_000,
      scope: "openid",
      subject: "s-1",
      user: "alice",
    })
  })

  it("revoke with a token type hint and resolve to undefined on 200", async () => {
    const { calls, deps } = capture(new Response(null, { status: 200 }))
    await expect(
      revokeToken(PUBLIC, { value: "r-1", hint: "refresh_token" }, deps),
    ).resolves.toBeUndefined()
    expect(formOf(calls[0]!.init)).toEqual({
      token: "r-1",
      token_type_hint: "refresh_token",
      client_id: "pulse-cli",
    })
  })

  it("resolve to the reason of a failed revocation, never reject", async () => {
    const error = capture(oauthError(400, "unsupported_token_type", "nope"))
    await expect(
      revokeToken(PUBLIC, { value: "a", hint: "access_token" }, error.deps),
    ).resolves.toBe("HTTP 400 Bad Request (unsupported_token_type: nope)")
    const status = capture(new Response("", { status: 503 }))
    await expect(
      revokeToken(PUBLIC, { value: "a", hint: "access_token" }, status.deps),
    ).resolves.toBe("HTTP 503 Service Unavailable")
    const down = capture(connectionRefused())
    await expect(
      revokeToken(PUBLIC, { value: "a", hint: "access_token" }, down.deps),
    ).resolves.toBe(`Cannot reach the authorization server at ${TOKEN_ENDPOINT} (ECONNREFUSED)`)
  })

  it("report a timeout as TIMEOUT", async () => {
    const hang = () => new Promise<Response>(() => undefined)
    const deps = { ...oauthDeps(fakeRuntime({ fetch: hang })), timeoutMs: 20 }
    const error = await rejection(refreshTokens(PUBLIC, "r", deps))
    expect(error.code).toBe("TIMEOUT")
    expect(error.message).toBe(
      `Cannot reach the authorization server at ${TOKEN_ENDPOINT} (timed out after 20 ms)`,
    )
  })

  it("show URLs without query in messages", async () => {
    const { deps } = capture(connectionRefused())
    const client = { ...PUBLIC, endpoint: { url: `${TOKEN_ENDPOINT}?key=secret`, source: "s" } }
    const error = await rejection(refreshTokens(client, "r", deps))
    expect(error.message).toBe(
      `Cannot reach the authorization server at ${TOKEN_ENDPOINT}?… (ECONNREFUSED)`,
    )
    expect(error.details.hint).toBe(
      "Check the issuer or endpoint (s) and the network; a private CA needs NODE_EXTRA_CA_CERTS.",
    )
  })
})

describe("a token answer without a usable token", () => {
  it.each([
    [
      { access_token: "" },
      "The token response has no access_token in the Bearer token syntax (RFC 6750).",
    ],
    [
      { access_token: "has space" },
      "The token response has no access_token in the Bearer token syntax (RFC 6750).",
    ],
    [
      { token_type: "Bearer" },
      "The token response has no access_token in the Bearer token syntax (RFC 6750).",
    ],
  ])("is CONFIG for %j", async (body, hint) => {
    const error = await refusal(tokenJson(body))
    expect(error).toMatchObject({
      code: "CONFIG",
      message: "The authorization server answered without a usable access token",
    })
    expect(error.details.hint).toBe(hint)
  })

  it("is CONFIG for an answer that is not a JSON object", async () => {
    const error = await refusal(new Response("<html>"))
    expect(error.message).toBe("The authorization server answered without a usable access token")
    expect(error.details.hint).toBe("The token endpoint did not answer with a JSON object.")
  })

  it.each(["DPoP", "mac", 7])("refuses the token type %j", async (type) => {
    const error = await refusal(tokenJson({ access_token: "a", token_type: type }))
    expect(error.message).toBe(
      `Unsupported token type "${String(type)}"; pulse sends Bearer tokens only`,
    )
  })
})

describe("idTokenClaims", () => {
  it("takes the email when there is no preferred_username, sanitized", () => {
    expect(idTokenClaims(jwt({ sub: "x\u001b[2J", email: "a@x" }))).toEqual({
      subject: "x[2J",
      user: "a@x",
    })
  })

  it.each([["not-a-jwt"], ["a.!!!.c"], [jwt({}).replace(/\..*\./, ".W10.")], [42]])(
    "is empty for %j",
    (token) => {
      expect(idTokenClaims(token)).toEqual({ subject: null, user: null })
    },
  )
})

describe("a refused token request", () => {
  it("maps invalid_grant on refresh to LOGIN_REQUIRED", async () => {
    const error = await refusal(oauthError(400, "invalid_grant", "Session not active"))
    expect(error.code).toBe("LOGIN_REQUIRED")
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" (invalid_grant: Session not active)',
    )
    expect(error.details.hint).toBe(
      `The session expired, was revoked, or the refresh token was replayed. ${HINT}`,
    )
  })

  it.each(["invalid_client", "unauthorized_client", "unsupported_grant_type", "invalid_scope"])(
    "maps %s to CONFIG on refresh and exchange",
    async (code) => {
      for (const grant of ["refresh", "exchange"] as const) {
        const error = await refusal(oauthError(401, code), grant)
        expect(error.code).toBe("CONFIG")
        expect(error.message).toBe(`The authorization server rejected client pulse-cli (${code})`)
        expect(error.details.hint).toContain("Keycloak answers unauthorized_client")
      }
    },
  )

  it("maps other refresh errors to LOGIN_REQUIRED", async () => {
    for (const code of ["invalid_request", "not_allowed"]) {
      const error = await refusal(oauthError(400, code, "d"))
      expect(error.code).toBe("LOGIN_REQUIRED")
      expect(error.message).toBe(`Refreshing the OAuth login of profile "p" failed (${code}: d)`)
      expect(error.details.hint).toBe(HINT)
    }
  })

  it("maps exchange errors to LOGIN_FAILED", async () => {
    const grant = await refusal(oauthError(400, "invalid_grant", "Code not valid"), "exchange")
    expect(grant.code).toBe("LOGIN_FAILED")
    expect(grant.message).toBe(
      "The authorization server rejected the authorization code (invalid_grant: Code not valid)",
    )
    expect(grant.details.hint).toBe(
      "The code expired or was already used; run `pulse auth login --profile p` again.",
    )
    const other = await refusal(oauthError(400, "invalid_request"), "exchange")
    expect(other.code).toBe("LOGIN_FAILED")
    expect(other.message).toBe("The code exchange failed (invalid_request)")
  })

  it("sanitizes and cuts the description", async () => {
    const long = "x".repeat(250)
    const error = await refusal(oauthError(400, "invalid_grant", `a\nb\u0007${long}`))
    expect(error.message).toBe(
      `The authorization server rejected the refresh token of profile "p" (invalid_grant: ab${"x".repeat(198)}…)`,
    )
  })

  it("maps 5xx to HTTP_SERVER_ERROR, keeping the login on refresh", async () => {
    const refresh = await refusal(tokenJson({ error: "x" }, 503))
    expect(refresh).toMatchObject({
      code: "HTTP_SERVER_ERROR",
      message: "The authorization server failed: HTTP 503 Service Unavailable",
    })
    expect(refresh.details).toMatchObject({
      status: 503,
      request: { method: "POST", url: TOKEN_ENDPOINT },
      hint: "Retry later; the login is kept.",
    })
    const exchange = await refusal(new Response("", { status: 500 }), "exchange")
    expect(exchange.details.hint).toBe("Retry later.")
  })

  it("maps redirects and answers without a JSON error to CONFIG", async () => {
    const redirect = await refusal(
      new Response("", { status: 302, headers: { location: "https://elsewhere" } }),
    )
    expect(redirect.code).toBe("CONFIG")
    expect(redirect.message).toBe(
      `Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 302 Found (pulse follows no redirects)`,
    )
    expect(redirect.details.hint).toBe('Check the token endpoint (auth.issuer of profile "p").')
    const forbidden = await refusal(tokenJson({ error: "x" }, 403))
    expect(forbidden.message).toBe(`Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 403 Forbidden`)
    const empty = await refusal(tokenJson({ error: "" }, 400))
    expect(empty.message).toBe(`Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 400 Bad Request`)
    const bare = await refusal(new Response("", { status: 401 }))
    expect(bare.message).toBe(`Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 401 Unauthorized`)
  })

  it("is what a failed token request throws", async () => {
    const idp = fakeIdp()
    const deps = oauthDeps(fakeRuntime({ fetch: idp.fetch }))
    const error = await rejection(refreshTokens(PUBLIC, "garbage", deps))
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" (invalid_grant: Invalid refresh token)',
    )
  })
})

describe("sanitize and statusLine", () => {
  it("removes control characters and cuts after 200 characters", () => {
    expect(sanitize("a\u0000b\nc")).toBe("abc")
    expect(sanitize("y".repeat(200))).toBe("y".repeat(200))
    expect(sanitize("y".repeat(201))).toBe(`${"y".repeat(200)}…`)
  })

  it("leaves out an empty reason phrase", () => {
    expect(statusLine({ status: 599, statusText: "" })).toBe("HTTP 599")
  })
})
