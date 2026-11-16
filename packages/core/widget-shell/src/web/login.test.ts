import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { oauthKeycloakProvider } from "../oauth-providers.js"
import { FAKE_OIDC_CLIENT, startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { LOGIN_COOKIE, openLogin, parseCookies } from "./cookies.js"
import { createSealer } from "./seal.js"
import {
  bootWeb,
  Browser,
  FLAGS,
  KEY,
  ORIGIN,
  RESOURCE,
  signIn,
  startSignIn,
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

const keycloak = () => oauthKeycloakProvider({ serverUrl: fake.serverUrl, realm: fake.realm })

/** The authorization request's parameters, each with all its values. */
const paramsOf = (authorization: string) => {
  const url = new URL(authorization)
  const names = [...new Set(url.searchParams.keys())]
  return Object.fromEntries(names.map((name) => [name, url.searchParams.getAll(name)]))
}

describe("GET /app/auth/login", () => {
  it("sends the browser to the provider with the code flow, PKCE S256, the state and the resource", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { login, authorization } = await startSignIn(browser, fake)
    expect(login.status).toBe(302)
    expect(login.headers.get("cache-control")).toBe("no-store")
    expect(authorization.startsWith(`${fake.issuer}/protocol/openid-connect/auth?`)).toBe(true)
    const params = paramsOf(authorization)
    expect(params).toEqual({
      response_type: ["code"],
      client_id: [FAKE_OIDC_CLIENT.id],
      redirect_uri: [`${ORIGIN}/app/auth/callback`],
      scope: ["openid profile"],
      state: [expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)],
      code_challenge: [expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)],
      code_challenge_method: ["S256"],
      resource: [RESOURCE],
    })
    expect(params.state).not.toEqual(params.code_challenge)
  })

  it("keeps the state, the verifier and the page to return to in the sealed login cookie", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { login, authorization } = await startSignIn(browser, fake, "/app/boards/ops?x=1")
    const [setCookie] = login.headers.getSetCookie()
    expect(setCookie).toMatch(
      new RegExp(`^${LOGIN_COOKIE}=[A-Za-z0-9._-]+; Max-Age=600; ${FLAGS}$`),
    )
    expect(login.headers.getSetCookie()).toHaveLength(1)
    const opened = await openLogin(createSealer([KEY]), parseCookies(setCookie.split(";")[0]))
    const state = new URL(authorization).searchParams.get("state")
    if (opened?.ok !== true) throw new Error("the login cookie does not open")
    expect(opened.login.state).toBe(state)
    expect(opened.login.returnTo).toBe("/app/boards/ops?x=1")
    expect(opened.login.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorization).not.toContain(opened.login.verifier)
  })

  it.each([
    ["no target", undefined, "/app"],
    ["a page", "/app/boards/ops?x=1", "/app/boards/ops?x=1"],
    ["another site", "//evil.example/app", "/app"],
    ["the logout route", "/app/auth/logout", "/app"],
    ["the API", "/app/api/session", "/app"],
    ["a trailing slash", "/app/", "/app"],
  ])("returns to the page the sign-in started from: %s", async (_case, returnTo, expected) => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const callback = await signIn(browser, fake, { returnTo })
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe(expected)
  })

  it("names the gate's resource as audience too for a provider that names a token's API by it", async () => {
    const provider = { ...keycloak(), web: { scopes: ["openid"], audience: "resource" as const } }
    const browser = new Browser(await bootWeb(webEnv(fake), { oauth: provider }))
    const params = paramsOf((await startSignIn(browser, fake)).authorization)
    expect(params.scope).toEqual(["openid"])
    expect(params.audience).toEqual([RESOURCE])
    expect(params.resource).toEqual([RESOURCE])
  })

  it("signs in with the scope openid alone through a provider that names no web client", async () => {
    const provider = keycloak()
    delete provider.web
    const browser = new Browser(await bootWeb(webEnv(fake), { oauth: provider }))
    const params = paramsOf((await startSignIn(browser, fake)).authorization)
    expect(params.scope).toEqual(["openid"])
    expect(params.audience).toBeUndefined()
  })

  it.each<[string, string[] | undefined, string]>([
    ["a provider without a web client", undefined, "openid profile mcp:tools"],
    ["a provider's web client", ["openid", "profile", "email"], "openid profile email mcp:tools"],
  ])(
    "asks for the scopes the gate requires besides those of %s, and signs in",
    async (_case, scopes, asked) => {
      const provider = { ...keycloak(), requiredScopes: ["profile", "mcp:tools"] }
      if (scopes === undefined) delete provider.web
      else provider.web = { scopes }
      const browser = new Browser(await bootWeb(webEnv(fake), { oauth: provider }))
      const { authorization } = await startSignIn(browser, fake)
      expect(paramsOf(authorization).scope).toEqual([asked])
      const callback = await browser.fetch(await fake.signIn(authorization))
      expect(callback.headers.get("location")).toBe("/app")
    },
  )

  it("names a provider's own resource, never one built from MCP_URL, and signs in with it", async () => {
    await fake.close()
    const own = "http://127.0.0.1/mcp"
    fake = await startFakeOidc({ audience: own })
    const provider = { ...keycloak(), resource: own }
    const browser = new Browser(await bootWeb(webEnv(fake), { oauth: provider }))
    const { authorization } = await startSignIn(browser, fake)
    expect(paramsOf(authorization).resource).toEqual([own])
    const callback = await browser.fetch(await fake.signIn(authorization))
    expect(callback.headers.get("location")).toBe("/app")
    const token = fake.requests.find(({ endpoint }) => endpoint === "token")
    expect(token?.form.getAll("resource")).toEqual([own])
  })

  it("sends the browser to the signed-out page while the provider does not answer, and boots", async () => {
    const closed = await startFakeOidc()
    await closed.close()
    const env = { ...webEnv(fake), MCP_OAUTH_KEYCLOAK_SERVER_URL: closed.serverUrl }
    const browser = new Browser(await bootWeb(env))
    const login = await browser.fetch("/app/auth/login")
    expect(login.status).toBe(303)
    expect(login.headers.get("location")).toBe("/app/signed-out?reason=unavailable")
    expect(login.headers.get("cache-control")).toBe("no-store")
    expect(login.headers.getSetCookie()).toEqual([])
    expect(warned).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[web-test\] Web sign-in: the discovery of .* failed: no answer \(unreachable\)/,
      ),
    )
  })
})
