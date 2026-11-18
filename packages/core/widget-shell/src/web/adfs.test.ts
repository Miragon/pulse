import { decodeJwt } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  startFakeOidc,
  type FakeOidc,
  type FakeOidcOptions,
} from "../testing/oidc/index.js"
import { FIXTURE_BUILD } from "./build.test-support.js"
import {
  bootWeb,
  Browser,
  ORIGIN,
  RESOURCE,
  SESSION_KEYS,
  sessionOf,
  signIn,
  startSignIn,
} from "./sign-in.test-support.js"

/**
 * The web sign-in through the generic OpenID Connect provider at the fake ADFS: the resource at
 * every grant, `openid` alone, one discovery for the gate and the sign-in, the caller from the
 * access token, the sign-out without revocation.
 */

let fake: FakeOidc
let warned: MockInstance<(...data: unknown[]) => void>

const startAdfs = async (options: FakeOidcOptions = {}) => {
  fake = await startFakeOidc({ flavor: "adfs", callerClaim: "sub", ...options })
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const [ALICE] = FAKE_OIDC_USERS

/** A server whose web app signs in at the fake ADFS through the generic provider. */
const bootAdfs = (extra: NodeJS.ProcessEnv = {}) =>
  bootWeb({
    ...fake.env(ORIGIN),
    MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
    MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
    MCP_WEB_SESSION_KEYS: SESSION_KEYS,
    MCP_WEB_DIR: FIXTURE_BUILD,
    ...extra,
  })

const requestsTo = (endpoint: string, grant?: string) =>
  fake.requests.filter(
    (request) =>
      request.endpoint === endpoint &&
      (grant === undefined || request.form.get("grant_type") === grant),
  )

describe("the web sign-in at ADFS", () => {
  it("asks openid with the resource, exchanges the code for it and takes the caller's upn as the name", async () => {
    await startAdfs()
    const browser = new Browser(await bootAdfs())
    const { authorization } = await startSignIn(browser, fake)
    const asked = new URL(authorization)
    expect(asked.pathname).toBe("/adfs/oauth2/authorize/")
    expect(asked.searchParams.get("scope")).toBe("openid")
    expect(asked.searchParams.getAll("resource")).toEqual([RESOURCE])
    const callback = await browser.fetch(await fake.signIn(authorization))
    expect(callback.headers.get("location")).toBe("/app")
    const [exchange] = requestsTo("token", "authorization_code")
    expect(exchange.form.getAll("resource")).toEqual([RESOURCE])
    expect([...exchange.form.keys()]).toEqual([
      "grant_type",
      "code",
      "redirect_uri",
      "code_verifier",
      "resource",
    ])
    expect(await sessionOf(browser)).toMatchObject({ status: 200, body: { name: ALICE.email } })
    // The gate's key set and the sign-in's metadata come from one discovery.
    expect(requestsTo("discovery")).toHaveLength(1)
  })

  it("asks the scopes MCP_WEB_SCOPES names, and lets the web client pass an allowlist of others", async () => {
    await startAdfs()
    const env = { MCP_WEB_SCOPES: "openid allatclaims", MCP_OAUTH_OIDC_CLIENT_IDS: "claude" }
    const browser = new Browser(await bootAdfs(env))
    const { authorization } = await startSignIn(browser, fake)
    expect(new URL(authorization).searchParams.get("scope")).toBe("openid allatclaims")
    const callback = await browser.fetch(await fake.signIn(authorization))
    expect(callback.headers.get("location")).toBe("/app")
  })

  it("renews with the resource and the refresh token ADFS keeps, and the session goes on", async () => {
    await startAdfs({ accessTokenSeconds: 5 })
    const browser = new Browser(await bootAdfs())
    await signIn(browser, fake)
    expect((await sessionOf(browser)).status).toBe(200)
    expect((await sessionOf(browser)).status).toBe(200)
    const renewals = requestsTo("token", "refresh_token")
    expect(renewals).toHaveLength(2)
    for (const renewal of renewals) {
      expect([...renewal.form.keys()]).toEqual(["grant_type", "refresh_token", "resource"])
      expect(renewal.form.getAll("resource")).toEqual([RESOURCE])
    }
    const [first, second] = renewals.map((renewal) => renewal.form.get("refresh_token"))
    expect(second).toBe(first)
    expect(decodeJwt(String(fake.issued.access.at(-1))).aud).toBe(RESOURCE)
  })

  it("signs out without a revocation, at ADFS's end of the session with the client and the signed-out page", async () => {
    await startAdfs()
    const browser = new Browser(await bootAdfs())
    await signIn(browser, fake)
    const { body } = await sessionOf(browser)
    const signedOut = await browser.logout(String(body.csrf))
    const next = new URL(String(((await signedOut.json()) as { location: string }).location))
    expect(`${next.origin}${next.pathname}`).toBe(`${fake.issuer}/oauth2/logout`)
    expect(Object.fromEntries(next.searchParams)).toEqual({
      client_id: FAKE_OIDC_CLIENT.id,
      post_logout_redirect_uri: `${ORIGIN}/app/signed-out`,
    })
    expect(fake.revoked).toEqual([])
    expect(requestsTo("unknown")).toEqual([])
  })

  it("refuses a sign-in whose access token names no caller, as without the issuance rule", async () => {
    await startAdfs({ callerClaim: undefined })
    const browser = new Browser(await bootAdfs())
    const callback = await signIn(browser, fake)
    expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
    expect(warned).toHaveBeenCalledWith(
      "[web-test] Web sign-in failed (failed): the gate refuses the access token (JWT verification failed).",
    )
  })
})
