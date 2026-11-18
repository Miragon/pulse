import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  startFakeOidc,
  type FakeOidc,
} from "../testing/oidc/index.js"
import { loginCookie, LOGIN_COOKIE, SESSION_COOKIE } from "./cookies.js"
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
  sessionOf,
  signIn,
  startSignIn,
  webEnv,
} from "./sign-in.test-support.js"

let fake: FakeOidc
let warned: MockInstance<(...data: unknown[]) => void>
let logged: MockInstance<(...data: unknown[]) => void>

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  vi.spyOn(console, "info").mockImplementation(() => {})
  logged = vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const [ALICE] = FAKE_OIDC_USERS
const sealer = createSealer([KEY])

const restart = async (options: Parameters<typeof startFakeOidc>[0]) => {
  await fake.close()
  fake = await startFakeOidc(options)
}

/** The callback URL `authorization` brings the browser back to, with its query changed. */
async function backWith(authorization: string, change: (query: URLSearchParams) => void) {
  const back = new URL(await fake.signIn(authorization))
  change(back.searchParams)
  return back.href
}

const warnings = () => warned.mock.calls.map(([line]) => String(line))

/** The browser on the server booted again, its cookies kept: the discovery is not read yet. */
async function afterRestart(browser: Browser): Promise<Browser> {
  const restarted = new Browser(await bootWeb(webEnv(fake)))
  for (const [name, value] of browser.cookies) restarted.cookies.set(name, value)
  return restarted
}

/** A failed sign-in: the signed-out page with its reason, the login cookie cleared, no session. */
function expectFailed(response: Response, reason: string) {
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe(`/app/signed-out?reason=${reason}`)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.getSetCookie()).toEqual([`${LOGIN_COOKIE}=; Max-Age=0; ${FLAGS}`])
}

describe("GET /app/auth/callback: a sign-in", () => {
  it("starts a session in the session cookie, clears the login cookie and returns to the page", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const callback = await signIn(browser, fake, { returnTo: "/app/boards/ops" })
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe("/app/boards/ops")
    expect(callback.headers.get("cache-control")).toBe("no-store")
    const [session, cleared] = callback.headers.getSetCookie()
    expect(session).toMatch(
      new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9._-]+; Max-Age=28800; ${FLAGS}$`),
    )
    expect(cleared).toBe(`${LOGIN_COOKIE}=; Max-Age=0; ${FLAGS}`)
    expect(callback.headers.getSetCookie()).toHaveLength(2)
    expect([...browser.cookies.keys()]).toEqual([SESSION_COOKIE])
    const { status, body } = await sessionOf(browser)
    expect(status).toBe(200)
    expect(body.name).toBe(ALICE.name)
  })

  it("exchanges the code as a confidential client, with its verifier, redirect URI and resource", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    await signIn(browser, fake)
    const token = fake.requests.find(({ endpoint }) => endpoint === "token")
    const basic = Buffer.from(`${FAKE_OIDC_CLIENT.id}:${FAKE_OIDC_CLIENT.secret}`).toString(
      "base64",
    )
    expect(token?.headers.authorization).toBe(`Basic ${basic}`)
    expect(token?.form.get("grant_type")).toBe("authorization_code")
    expect(token?.form.get("redirect_uri")).toBe(`${ORIGIN}/app/auth/callback`)
    expect(token?.form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token?.form.getAll("resource")).toEqual([RESOURCE])
    expect(token?.form.has("client_secret")).toBe(false)
    // The scopes go with the authorization request alone, as before a web client could name them.
    expect([...(token?.form.keys() ?? [])]).toEqual([
      "grant_type",
      "code",
      "redirect_uri",
      "code_verifier",
      "resource",
    ])
  })

  it("seals the tokens, never the ID token, and writes no token into the log", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    await signIn(browser, fake)
    const opened = await sealer.open(SESSION_COOKIE, browser.cookies.get(SESSION_COOKIE) ?? "")
    const session = (opened.ok ? opened.value : undefined) as WebSession
    const { receivedAt } = session.tokens
    expect(receivedAt).toBeLessThanOrEqual(Date.now())
    expect(session.tokens).toEqual({
      accessToken: fake.issued.access[0],
      receivedAt,
      expiresAt: session.tokens.receivedAt + 300_000,
      refreshToken: fake.issued.refresh[0],
      refreshExpiresAt: session.tokens.receivedAt + 1_800_000,
    })
    expect(JSON.stringify(session)).not.toContain(fake.issued.id[0])
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const lines = [...logged.mock.calls, ...warned.mock.calls].map(([line]) => String(line))
    for (const token of [...fake.issued.access, ...fake.issued.refresh, ...fake.issued.id]) {
      expect(lines.join("\n")).not.toContain(token)
    }
  })

  it("logs the callback without its query, which carries the code and the state", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake, { MCP_LOG_LEVEL: "trace" })))
    const { authorization } = await startSignIn(browser, fake)
    const back = new URL(await fake.signIn(authorization))
    await browser.fetch(back.href)
    const lines = logged.mock.calls.map(([line]) => String(line)).join("\n")
    expect(lines).not.toContain(back.searchParams.get("code"))
    // The login's answer names the state in its Location (a trace shows it, as the browser does);
    // the callback's lines name neither its query nor what it set.
    const callback = lines.slice(lines.indexOf("GET /app/auth/callback"))
    expect(callback).toMatch(/^GET \/app\/auth\/callback 303 \d+ms\n/)
    expect(callback).not.toContain(back.searchParams.get("state"))
    expect(callback).toContain('"set-cookie": "[REDACTED]"')
  })

  it("replaces a planted session with a new one: a new id and a new CSRF secret", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const planted: WebSession = {
      id: "planted",
      csrf: "planted-csrf",
      name: "Mallory",
      tokens: { accessToken: "a", receivedAt: Date.now() },
    }
    const sealed = await sealer.seal(SESSION_COOKIE, planted, Date.now() + HOUR)
    browser.cookies.set(SESSION_COOKIE, sealed)
    expect((await sessionOf(browser)).body).toMatchObject({ name: "Mallory", csrf: "planted-csrf" })
    browser.cookies.set(`${SESSION_COOKIE}.1`, "stale")
    browser.cookies.set(`${SESSION_COOKIE}.2`, "stale")
    const callback = await signIn(browser, fake)
    expect(callback.headers.getSetCookie()).toEqual([
      expect.stringMatching(new RegExp(`^${SESSION_COOKIE}=`)),
      `${SESSION_COOKIE}.1=; Max-Age=0; ${FLAGS}`,
      `${SESSION_COOKIE}.2=; Max-Age=0; ${FLAGS}`,
      `${LOGIN_COOKIE}=; Max-Age=0; ${FLAGS}`,
    ])
    const { body } = await sessionOf(browser)
    expect(body.name).toBe(ALICE.name)
    expect(body.csrf).not.toBe("planted-csrf")
    const opened = await sealer.open(SESSION_COOKIE, browser.cookies.get(SESSION_COOKIE) ?? "")
    expect((opened.ok ? opened.value : undefined) as WebSession).toMatchObject({ name: ALICE.name })
    expect(((opened.ok ? opened.value : {}) as WebSession).id).not.toBe("planted")
  })

  it("starts a new session with every sign-in, also of the same user", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    await signIn(browser, fake)
    const first = (await sessionOf(browser)).body.csrf
    await signIn(browser, fake, { username: "bob" })
    const second = await sessionOf(browser)
    expect(second.body.name).toBe("Bob Brown")
    expect(second.body.csrf).not.toBe(first)
  })
})

describe("GET /app/auth/callback: what it refuses before it asks the provider", () => {
  /** Requests to the provider from now on: none may follow a refused callback. */
  const asked = (before: number) => fake.requests.slice(before).map(({ endpoint }) => endpoint)

  it("refuses a callback without its login cookie", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await fake.signIn(authorization)
    browser.cookies.clear()
    const before = fake.requests.length
    expectFailed(await browser.fetch(back), "failed")
    expect(asked(before)).toEqual([])
    expect(warnings()).toContain(
      "[web-test] Web sign-in failed (failed): the callback came without its login cookie.",
    )
  })

  it("refuses a callback with another sign-in's state, before even the discovery", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await backWith(authorization, (query) => query.set("state", "another"))
    const restarted = await afterRestart(browser)
    const before = fake.requests.length
    expectFailed(await restarted.fetch(back), "failed")
    expect(asked(before)).toEqual([])
    expect(warnings().at(-1)).toContain("another sign-in's state")
  })

  it("refuses a callback whose iss names another provider (the mix-up attack), before even the discovery", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await backWith(authorization, (query) => query.set("iss", "https://evil.example"))
    const restarted = await afterRestart(browser)
    const before = fake.requests.length
    expectFailed(await restarted.fetch(back), "failed")
    expect(asked(before)).toEqual([])
    expect(warnings().at(-1)).toContain("iss does not name the identity provider")
  })

  it("asks for the discovery first on a server booted again, for a callback that passes", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await fake.signIn(authorization)
    const restarted = await afterRestart(browser)
    const before = fake.requests.length
    expect((await restarted.fetch(back)).headers.get("location")).toBe("/app")
    expect(asked(before)).toEqual(["discovery", "token", "jwks"])
  })

  it("refuses the callback of a login cookie sealed for another cookie, or by another key", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await fake.signIn(authorization)
    const other = createSealer([new Uint8Array(32).fill(9)])
    const login = {
      state: new URL(back).searchParams.get("state") ?? "",
      verifier: "v",
      returnTo: "/app",
    }
    browser.cookies.set(LOGIN_COOKIE, (await loginCookie(other, login)).split(";")[0].split("=")[1])
    const before = fake.requests.length
    expectFailed(await browser.fetch(back), "failed")
    expect(asked(before)).toEqual([])
    expect(warnings().at(-1)).toContain("the login cookie is invalid")
  })

  it("refuses a sign-in that took longer than its login cookie lasts", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await fake.signIn(authorization)
    const state = new URL(back).searchParams.get("state") ?? ""
    const stale = await loginCookie(
      sealer,
      { state, verifier: "v", returnTo: "/app" },
      Date.now() - 601_000,
    )
    browser.cookies.set(LOGIN_COOKIE, stale.split(";")[0].split("=")[1])
    expectFailed(await browser.fetch(back), "expired")
    expect(warnings().at(-1)).toContain("the login cookie is expired")
  })
})

describe("GET /app/auth/callback: what the provider answers", () => {
  it("says denied when the user cancels at the provider", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    expectFailed(await browser.fetch(await fake.decline(authorization)), "denied")
    expect(warnings().at(-1)).toBe(
      "[web-test] Web sign-in failed (denied): the identity provider answered access_denied.",
    )
  })

  it("says failed for another error, and logs its code without what else it holds", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await backWith(authorization, (query) => {
      query.delete("code")
      query.set("error", "server_error <script>")
      query.set("error_description", "secret detail")
    })
    expectFailed(await browser.fetch(back), "failed")
    expect(warnings().at(-1)).toBe(
      "[web-test] Web sign-in failed (failed): the identity provider answered server_errorscript.",
    )
  })

  it("refuses a callback without a code", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await backWith(authorization, (query) => query.delete("code"))
    expectFailed(await browser.fetch(back), "failed")
    expect(warnings().at(-1)).toContain("the callback carries no code")
  })

  it("refuses a callback without iss once the provider says it sends one (RFC 9207)", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await backWith(authorization, (query) => query.delete("iss"))
    expectFailed(await browser.fetch(back), "failed")
    expect(fake.requests.some(({ endpoint }) => endpoint === "token")).toBe(false)
  })

  it("refuses a code the provider no longer takes", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { authorization } = await startSignIn(browser, fake)
    const back = await fake.signIn(authorization)
    const cookie = browser.cookieHeader
    await browser.fetch(back)
    const replayed = new Browser(await bootWeb(webEnv(fake)))
    for (const pair of cookie.split("; ")) {
      const at = pair.indexOf("=")
      replayed.cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
    expectFailed(await replayed.fetch(back), "failed")
    expect(warnings().at(-1)).toContain(
      "the token endpoint gave no token (no token: grant (HTTP 400) (invalid_grant))",
    )
  })

  it("says audience for a token that does not carry this server's resource", async () => {
    await restart({})
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expectFailed(await signIn(browser, fake), "audience")
    expect(warnings().at(-1)).toContain("Token audience claim must be a string or string array")
    expect((await sessionOf(browser)).status).toBe(401)
  })

  it("says audience for a token bound to another resource", async () => {
    await restart({ audience: "https://other.example/mcp" })
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expectFailed(await signIn(browser, fake), "audience")
  })

  it("says failed for a token the gate refuses for another reason", async () => {
    await restart({ audience: RESOURCE, accessTokenSeconds: 0 })
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expectFailed(await signIn(browser, fake), "failed")
    expect(warnings().at(-1)).toContain("the gate refuses the access token")
  })

  it("signs in without a refresh token, and logs that such a session ends with its access token", async () => {
    await restart({ audience: RESOURCE, refreshTokens: false })
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expect((await signIn(browser, fake)).headers.get("location")).toBe("/app")
    expect((await sessionOf(browser)).status).toBe(200)
    expect(fake.issued.refresh).toEqual([])
    expect(warnings().filter((line) => line.includes("refresh token"))).toEqual([
      "[web-test] Web sign-in: the identity provider gave no refresh token, so the session ends " +
        "when its access token expires and is never checked at the provider. Allow refresh tokens " +
        "(offline_access) for client pulse-web at the provider.",
    ])
  })

  it("fails a session larger than its three cookies hold", async () => {
    await restart({
      audience: RESOURCE,
      users: [{ sub: "big", username: "big", name: "x".repeat(12_000) }],
    })
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expectFailed(await signIn(browser, fake), "failed")
    expect(warnings().at(-1)).toMatch(
      /the session needs \d+ bytes, more than its cookies hold \(its access token holds \d+ bytes\)\.$/,
    )
  })
})
