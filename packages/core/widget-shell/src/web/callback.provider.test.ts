import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { authorizationUrl, createPkce } from "@miragon/pulse-http/oauth"
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server"
import {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  startFakeOidc,
  type FakeOidc,
} from "../testing/oidc/index.js"
import type { WebContext } from "./context.js"
import { callbackRoute } from "./callback.js"
import { loginCookie, LOGIN_COOKIE, SESSION_COOKIE } from "./cookies.js"
import { createSealer } from "./seal.js"
import type { WebSession } from "./session.js"
import { FLAGS, KEY, ORIGIN, RESOURCE, requestTo, webContext } from "./sign-in.test-support.js"

/**
 * The callback route on a context built by hand: the gate's answer and the provider's metadata
 * replaced, for the names a session takes and the provider's failures a whole server cannot stage.
 */

let fake: FakeOidc

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const [ALICE] = FAKE_OIDC_USERS
const sealer = createSealer([KEY])

/** A failed sign-in: the signed-out page with its reason, the login cookie cleared, no session. */
function expectFailed(response: Response, reason: string) {
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe(`/app/signed-out?reason=${reason}`)
  expect(response.headers.getSetCookie()).toEqual([`${LOGIN_COOKIE}=; Max-Age=0; ${FLAGS}`])
}

/** A login at the fake as `ctx` would start it, and the callback's answer on `ctx`. */
async function callbackOn(ctx: WebContext, scopes?: string[]) {
  const metadata = await webContext(fake).ctx.metadata()
  const pkce = await createPkce()
  const authorization = authorizationUrl(String(metadata?.authorizationEndpoint), {
    clientId: FAKE_OIDC_CLIENT.id,
    redirectUri: `${ORIGIN}/app/auth/callback`,
    ...(scopes === undefined ? {} : { scopes }),
    challenge: pkce.challenge,
    state: pkce.state,
  })
  const login = await loginCookie(sealer, {
    state: pkce.state,
    verifier: pkce.verifier,
    returnTo: "/app",
  })
  const back = await fake.signIn(authorization)
  return callbackRoute(ctx)(requestTo(back, { cookie: login.split(";")[0] }))
}

describe("GET /app/auth/callback: the name the page shows", () => {
  /** A whole sign-in through the route alone, its gate's answer `caller`. */
  async function nameAfter(caller: (token: string) => AuthInfo, scopes = ["openid", "profile"]) {
    const { ctx } = webContext(fake, {
      client: { scopes },
      verify: (token) => Promise.resolve(caller(token)),
    })
    const [session] = (await callbackOn(ctx, scopes)).headers.getSetCookie()
    const opened = await sealer.open(SESSION_COOKIE, session.split(";")[0].split("=")[1])
    return ((opened.ok ? opened.value : {}) as WebSession).name
  }

  const authInfo = (token: string, payload: Record<string, unknown>): AuthInfo => ({
    token,
    clientId: FAKE_OIDC_CLIENT.id,
    scopes: [],
    expiresAt: Date.now() / 1000 + 300,
    resource: new URL(RESOURCE),
    extra: { payload, user: { id: payload.sub } },
  })

  it("takes the ID token's name when the access token carries none", async () => {
    expect(await nameAfter((token) => authInfo(token, { sub: ALICE.sub }))).toBe(ALICE.name)
  })

  it("takes no name of an ID token of another subject, and falls back to the subject", async () => {
    expect(await nameAfter((token) => authInfo(token, { sub: "someone-else" }))).toBe(
      "someone-else",
    )
  })

  it("reads the access token's claims without an ID token", async () => {
    const caller = (token: string) => authInfo(token, { sub: "u-1", email: "u@example.test" })
    expect(await nameAfter(caller, ["profile"])).toBe("u@example.test")
  })

  it("takes out control characters and keeps at most 100 characters", async () => {
    const caller = (token: string) =>
      authInfo(token, { sub: "u-1", name: `A\u0007${"b".repeat(200)}` })
    expect(await nameAfter(caller, ["profile"])).toBe(`A${"b".repeat(99)}`)
  })
})

describe("GET /app/auth/callback: a provider that cannot answer now", () => {
  /** The callback's answer on a context with `overrides`, and what it logged. */
  async function callbackWith(overrides: Partial<WebContext>) {
    const { ctx, logged: lines } = webContext(fake, overrides)
    return { response: await callbackOn(ctx), lines }
  }

  it("says unavailable when the metadata no longer loads at the callback", async () => {
    const { response, lines } = await callbackWith({ metadata: () => Promise.resolve(undefined) })
    expectFailed(response, "unavailable")
    expect(lines).toEqual([
      "Web sign-in failed (unavailable): the identity provider's metadata did not load.",
    ])
  })

  it("says unavailable when the token endpoint does not answer", async () => {
    const closed = await startFakeOidc()
    await closed.close()
    const metadata = await webContext(fake).ctx.metadata()
    const tokenEndpoint = `${closed.serverUrl}/token`
    const { response, lines } = await callbackWith({
      metadata: () => Promise.resolve(metadata && { ...metadata, tokenEndpoint }),
    })
    expectFailed(response, "unavailable")
    expect(lines[0]).toContain("the token endpoint gave no token (no token: unreachable)")
  })

  it("says unavailable while the gate cannot load the provider's keys", async () => {
    const unavailable = new OAuthError(OAuthErrorCode.TemporarilyUnavailable, "keys did not load")
    const { response } = await callbackWith({ verify: () => Promise.reject(unavailable) })
    expectFailed(response, "unavailable")
  })

  it("says failed for anything else the gate's check throws", async () => {
    const { response, lines } = await callbackWith({
      verify: () => Promise.reject(new Error("bug")),
    })
    expectFailed(response, "failed")
    expect(lines[0]).toBe("Web sign-in failed (failed): the gate refuses the access token (bug).")
  })
})
