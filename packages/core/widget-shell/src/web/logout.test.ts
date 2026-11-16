import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ServerMetadata } from "@miragon/pulse-http/oauth"
import { FAKE_OIDC_CLIENT, startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { LOGIN_COOKIE, SESSION_COOKIE } from "./cookies.js"
import { logoutRoute } from "./logout.js"
import { createSealer } from "./seal.js"
import type { WebSession } from "./session.js"
import {
  bootWeb,
  Browser,
  FLAGS,
  HOUR,
  KEY,
  ORIGIN,
  RESOURCE,
  requestTo,
  sessionOf,
  signIn,
  webContext,
  webEnv,
} from "./sign-in.test-support.js"

let fake: FakeOidc
let warned: MockInstance<(...data: unknown[]) => void>

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const sealer = createSealer([KEY])

const CLEARED = [
  `${SESSION_COOKIE}=; Max-Age=0; ${FLAGS}`,
  `${SESSION_COOKIE}.1=; Max-Age=0; ${FLAGS}`,
  `${SESSION_COOKIE}.2=; Max-Age=0; ${FLAGS}`,
  `${LOGIN_COOKIE}=; Max-Age=0; ${FLAGS}`,
]

/** A browser signed in at a fresh server, and the CSRF token its page reads. */
async function signedIn() {
  const browser = new Browser(await bootWeb(webEnv(fake)))
  await signIn(browser, fake)
  const csrf = String((await sessionOf(browser)).body.csrf)
  return { browser, csrf }
}

describe("POST /app/auth/logout", () => {
  it("revokes the refresh token, clears every cookie and names the provider's end of the session", async () => {
    const { browser, csrf } = await signedIn()
    const response = await browser.logout(csrf)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    const end = new URL(String(((await response.json()) as { location: string }).location))
    expect(`${end.origin}${end.pathname}`).toBe(`${fake.issuer}/protocol/openid-connect/logout`)
    expect([...end.searchParams]).toEqual([
      ["client_id", FAKE_OIDC_CLIENT.id],
      ["post_logout_redirect_uri", `${ORIGIN}/app/signed-out`],
    ])
    expect(fake.revoked).toEqual([fake.issued.refresh[0]])
    expect(browser.cookies.size).toBe(0)
    expect((await sessionOf(browser)).status).toBe(401)
  })

  it("leaves the provider's session to end where the answer sends the browser", async () => {
    const { browser, csrf } = await signedIn()
    const { location } = (await (await browser.logout(csrf)).json()) as { location: string }
    const ended = await fetch(location, { redirect: "manual" })
    expect(ended.headers.get("location")).toBe(`${ORIGIN}/app/signed-out`)
    expect(fake.endedSessions).toEqual([
      expect.objectContaining({
        clientId: FAKE_OIDC_CLIENT.id,
        postLogoutRedirectUri: `${ORIGIN}/app/signed-out`,
      }),
    ])
  })

  it.each([
    ["without the CSRF token", { "x-pulse-csrf": "" }, "no-token"],
    ["with another CSRF token", { "x-pulse-csrf": "another" }, "wrong-token"],
    ["from another origin the edge admits", { origin: "http://127.0.0.1" }, "origin"],
    ["from another site", { "sec-fetch-site": "cross-site" }, "cross-site"],
  ])("refuses a request %s, and signs nobody out", async (_case, headers, refusal) => {
    const { browser, csrf } = await signedIn()
    const response = await browser.logout(csrf, headers)
    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await response.json()).toEqual({
      message: "Refused: the request did not come from the app's page.",
    })
    expect(fake.revoked).toEqual([])
    expect((await sessionOf(browser)).status).toBe(200)
    expect(warned).toHaveBeenCalledWith(`[web-test] Web sign-out refused: ${refusal}.`)
  })

  it("leaves a foreign origin to the edge guard, in front of everything", async () => {
    const { browser, csrf } = await signedIn()
    const response = await browser.logout(csrf, { origin: "https://evil.example" })
    expect(response.status).toBe(403)
    expect(await response.text()).toContain("DNS-rebinding protection")
    expect((await sessionOf(browser)).status).toBe(200)
  })

  it("answers 401 signed_out without a session, and sets no cookie", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const response = await browser.logout("any")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: "signed_out",
      message: "No session: sign in again.",
    })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("clears a session cookie that no longer opens", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    browser.cookies.set(SESSION_COOKIE, "not.a.sealed.session")
    const response = await browser.logout("any")
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual(CLEARED.slice(0, 3))
  })
})

describe("POST /app/auth/logout: what the provider offers", () => {
  /** A session sealed by hand, with `tokens` in it. */
  async function logoutWith(
    metadata: ServerMetadata | undefined,
    tokens: WebSession["tokens"] = { accessToken: "a", receivedAt: Date.now(), refreshToken: "r" },
  ) {
    const { ctx, logged } = webContext(fake, { metadata: () => Promise.resolve(metadata) })
    const session: WebSession = { id: "s", csrf: "c", name: "n", tokens }
    const sealed = await sealer.seal(SESSION_COOKIE, session, Date.now() + HOUR)
    const headers = { cookie: `${SESSION_COOKIE}=${sealed}`, origin: ORIGIN, "x-pulse-csrf": "c" }
    const response = await logoutRoute(ctx)(requestTo("/app/auth/logout", headers, "POST"))
    const { location } = (await response.json()) as { location: string }
    return { response, location, logged }
  }

  const metadataOf = async () => {
    const found = await webContext(fake).ctx.metadata()
    if (found === undefined) throw new Error("the fake gave no metadata")
    return found
  }

  it("sends the browser to the signed-out page while the provider does not answer", async () => {
    const { response, location } = await logoutWith(undefined)
    expect(response.status).toBe(200)
    expect(location).toBe("/app/signed-out")
    expect(fake.revoked).toEqual([])
  })

  it("revokes nothing and ends nothing where the provider offers neither", async () => {
    const { issuer, authorizationEndpoint, tokenEndpoint, issParameterRequired, clientAuth } =
      await metadataOf()
    const bare = { issuer, authorizationEndpoint, tokenEndpoint, issParameterRequired, clientAuth }
    const { location } = await logoutWith(bare)
    expect(location).toBe("/app/signed-out")
    expect(fake.revoked).toEqual([])
  })

  it("revokes nothing for a session without a refresh token", async () => {
    const { location } = await logoutWith(await metadataOf(), {
      accessToken: "a",
      receivedAt: Date.now(),
    })
    expect(location).toContain("/protocol/openid-connect/logout?")
    expect(fake.revoked).toEqual([])
  })

  it("signs out all the same when the revocation fails, and logs it", async () => {
    const closed = await startFakeOidc()
    await closed.close()
    const metadata = { ...(await metadataOf()), revocationEndpoint: `${closed.serverUrl}/revoke` }
    const { response, logged } = await logoutWith(metadata)
    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(logged).toEqual([
      "Web sign-out: the refresh token was not revoked (no token: unreachable).",
    ])
  })
})
