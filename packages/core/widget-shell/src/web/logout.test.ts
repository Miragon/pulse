import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ServerMetadata } from "@miragon/pulse-http/oauth"
import { FAKE_OIDC_CLIENT, startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { ENDED_COOKIE, LOGIN_COOKIE, SESSION_COOKIE } from "./cookies.js"
import { logoutRoute } from "./logout.js"
import { createSealer } from "./seal.js"
import type { WebSession } from "./session.js"
import type { McpHttpApp } from "../mcp-server.js"
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

/** A browser signed in at `app` (a fresh server by default), and the CSRF token its page reads. */
async function signedIn(app?: McpHttpApp) {
  const browser = new Browser(app ?? (await bootWeb(webEnv(fake))))
  await signIn(browser, fake)
  const csrf = String((await sessionOf(browser)).body.csrf)
  return { browser, csrf }
}

/** A browser at `app` that holds a copy of `browser`'s cookies, or of those `names` names. */
function copyOf(browser: Browser, app: McpHttpApp, names?: readonly string[]): Browser {
  const copy = new Browser(app)
  for (const [name, value] of browser.cookies) {
    if (names === undefined || names.includes(name)) copy.cookies.set(name, value)
  }
  return copy
}

/** A page's call as the browser sends it, with the CSRF token. */
const callOf = (browser: Browser, csrf: string) =>
  browser.fetch("/app/api/call", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-pulse-csrf": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "probe_tool", arguments: {} }),
  })

const SESSION_CHUNKS = [SESSION_COOKIE, `${SESSION_COOKIE}.1`, `${SESSION_COOKIE}.2`]

/** The id of the session the logout's ended cookie names, opened with the server's own seal. */
async function endedOf(setCookie: string | undefined): Promise<unknown> {
  const [pair] = String(setCookie).split(";")
  const opened = await sealer.open(ENDED_COOKIE, pair.slice(`${ENDED_COOKIE}=`.length))
  return opened.ok ? opened.value : opened
}

describe("POST /app/auth/logout", () => {
  it("revokes the refresh token, clears every cookie and names the provider's end of the session", async () => {
    const { browser, csrf } = await signedIn()
    const response = await browser.logout(csrf)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const setCookies = response.headers.getSetCookie()
    expect(setCookies.slice(0, 4)).toEqual(CLEARED)
    // The ended cookie names the session for as long as the session would have lasted.
    expect(setCookies[4]).toMatch(
      new RegExp(`^${ENDED_COOKIE}=[A-Za-z0-9._-]+; Max-Age=(28800|28799); ${FLAGS}$`),
    )
    expect(setCookies).toHaveLength(5)
    const end = new URL(String(((await response.json()) as { location: string }).location))
    expect(`${end.origin}${end.pathname}`).toBe(`${fake.issuer}/protocol/openid-connect/logout`)
    expect([...end.searchParams]).toEqual([
      ["client_id", FAKE_OIDC_CLIENT.id],
      ["post_logout_redirect_uri", `${ORIGIN}/app/signed-out`],
    ])
    expect(fake.revoked).toEqual([fake.issued.refresh[0]])
    expect([...browser.cookies.keys()]).toEqual([ENDED_COOKIE])
    expect((await sessionOf(browser)).status).toBe(401)
  })

  it("ends the session on the server: a copy of its cookie opens it no more", async () => {
    const app = await bootWeb(webEnv(fake))
    const { browser, csrf } = await signedIn(app)
    // Someone holds a copy of the session cookie, taken before the sign-out, and its CSRF token.
    const copy = copyOf(browser, app, SESSION_CHUNKS)
    expect(await sessionOf(copy)).toMatchObject({ status: 200, body: { csrf } })
    expect((await browser.logout(csrf)).status).toBe(200)
    const call = await callOf(copy, csrf)
    expect(call.status).toBe(401)
    expect(await call.json()).toEqual({ code: "signed_out", message: "No session: sign in again." })
    expect(call.headers.getSetCookie()).toEqual(CLEARED.slice(0, 3))
    expect(warned).toHaveBeenCalledWith("[web-test] Web session refused: it was signed out.")
    expect((await sessionOf(copyOf(browser, app, SESSION_CHUNKS))).status).toBe(401)
  })

  it("leaves the browser the ended cookie, so no replica opens the session for it again", async () => {
    // Two replicas built with the same keys: the sign-out reaches one, a call under way the other.
    const one = await bootWeb(webEnv(fake))
    const other = await bootWeb(webEnv(fake))
    const { browser, csrf } = await signedIn(one)
    const before = copyOf(browser, other, SESSION_CHUNKS)
    const response = await browser.logout(csrf)
    const ended = (await endedOf(response.headers.getSetCookie()[4])) as { id: string }
    expect(Object.keys(ended)).toEqual(["id"])
    expect(ended.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    // The browser holds its ended cookie and the session cookie the call under way set again.
    const restored = copyOf(browser, other)
    for (const [name, value] of before.cookies) restored.cookies.set(name, value)
    const read = await restored.fetch("/app/api/session")
    expect(read.status).toBe(401)
    expect(read.headers.getSetCookie()).toEqual(CLEARED.slice(0, 3))
    expect([...restored.cookies.keys()]).toEqual([ENDED_COOKIE])
    // A copy elsewhere, without it, reaches the other replica until its access token runs out.
    expect((await sessionOf(before)).status).toBe(200)
  })

  it("keeps the ended cookie through the next sign-in, whose session it leaves alone", async () => {
    const one = await bootWeb(webEnv(fake))
    const other = await bootWeb(webEnv(fake))
    const { browser, csrf } = await signedIn(one)
    const old = copyOf(browser, one, SESSION_CHUNKS)
    await browser.logout(csrf)
    await signIn(browser, fake, { username: "bob" })
    expect(browser.cookies.has(ENDED_COOKIE)).toBe(true)
    expect((await sessionOf(copyOf(browser, other))).body).toMatchObject({ name: "Bob Brown" })
    // The old session's cookie, set again by a late answer, opens nothing of Alice's anywhere.
    for (const [name, value] of old.cookies) browser.cookies.set(name, value)
    expect((await sessionOf(copyOf(browser, other))).status).toBe(401)
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
    expect(response.headers.getSetCookie().slice(0, 4)).toEqual(CLEARED)
    expect(response.headers.getSetCookie()[4]).toMatch(/; Max-Age=(3600|3599); /)
    expect(await endedOf(response.headers.getSetCookie()[4])).toEqual({ id: "s" })
    expect(logged).toEqual([
      "Web sign-out: the refresh token was not revoked (no token: unreachable).",
    ])
  })
})
