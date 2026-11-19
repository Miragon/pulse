import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { NO_DOCUMENT_HOLD_MS } from "../oauth-discovery.js"
import { now, sign, startIdp, type Idp } from "../oauth-jwt.test-support.js"
import { FAKE_OIDC_CLIENT } from "../testing/oidc/index.js"
import { FIXTURE_BUILD } from "./build.test-support.js"
import { bootWeb, Browser, ORIGIN, RESOURCE, SESSION_KEYS } from "./sign-in.test-support.js"

/**
 * The identity provider's discovery through a whole server with the web app on, at the generic
 * provider: what the requests of a stranger (a login, any bearer token) cost at the provider while
 * a half has no answer, and a remote issuer's document whose endpoints lie on the server's own
 * machine, where the sign-in sends nothing.
 */

let warned: MockInstance<(...data: unknown[]) => void>

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The variables of a server whose web app signs in at `issuer` through the generic provider. */
const oidcEnv = (issuer: string): NodeJS.ProcessEnv => ({
  MCP_URL: ORIGIN,
  MCP_OAUTH_OIDC_ISSUER: issuer,
  MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
  MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
  MCP_WEB_SESSION_KEYS: SESSION_KEYS,
  MCP_WEB_DIR: FIXTURE_BUILD,
})

/** The lines the discovery logged, by the half that said them. */
const discoveryLines = () =>
  warned.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("discovery of"))

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "u", version: "0" },
  },
})

describe("a stranger's requests while a half of the discovery has no answer", () => {
  let idp: Idp
  beforeEach(async () => {
    idp = await startIdp()
  })
  afterEach(() => idp.close())

  const discoveryPath = () => `${new URL(idp.issuer).pathname}/.well-known/openid-configuration`
  const discoveries = () => idp.paths.filter((path) => path === discoveryPath()).length

  /** Ten logins without a cookie, each ending on the signed-out page. */
  async function logins(browser: Browser) {
    for (let count = 0; count < 10; count += 1) {
      const login = await browser.fetch("/app/auth/login")
      expect(login.headers.get("location")).toBe("/app/signed-out?reason=unavailable")
    }
  }

  /** Ten requests to `/mcp`, each with a token anyone may make up, which the gate cannot check. */
  async function bearers(browser: Browser, status: number) {
    const token = sign({ iss: idp.issuer, aud: RESOURCE, sub: "stranger", exp: now() + 60 })
    for (let count = 0; count < 10; count += 1) {
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      }
      const answer = await browser.fetch("/mcp", { method: "POST", headers, body: INITIALIZE })
      expect(answer.status).toBe(status)
    }
  }

  it("reads a provider that gives no document once per half and hold, and says so once per half", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    idp.answer = { status: 503, body: "{}" }
    const browser = new Browser(await bootWeb(oidcEnv(idp.issuer)))
    await logins(browser)
    await bearers(browser, 503)
    expect(discoveries()).toBe(2)
    const failed = `the discovery of ${idp.issuer} failed: ${idp.url}${discoveryPath()} answered 503.`
    expect(discoveryLines()).toEqual([
      `[web-test] Web sign-in: ${failed} Until it answers, a sign-in ends on the signed-out page.`,
      `[web-test] OAuth: ${failed} Until it answers, /mcp answers 503 (temporarily_unavailable).`,
    ])
    vi.setSystemTime(Date.now() + NO_DOCUMENT_HOLD_MS)
    await logins(browser)
    await bearers(browser, 503)
    expect(discoveries()).toBe(4)
    expect(discoveryLines()).toHaveLength(2)
  })

  it("reads a document the sign-in cannot use once for any number of logins, while the gate uses it", async () => {
    idp.sets[discoveryPath()] = {
      issuer: idp.issuer,
      authorization_endpoint: `${idp.issuer}/auth`,
      token_endpoint: `${idp.issuer}/token`,
      jwks_uri: `${idp.url}/keys`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
    }
    const browser = new Browser(await bootWeb(oidcEnv(idp.issuer)))
    await logins(browser)
    await bearers(browser, 200)
    expect(discoveries()).toBe(1)
    expect(discoveryLines()).toEqual([
      `[web-test] Web sign-in: the discovery of ${idp.issuer} failed: the document cannot be used (client-auth). Until it answers, a sign-in ends on the signed-out page.`,
    ])
  })
})

describe("a remote issuer's document that names endpoints on the server's own machine", () => {
  let listener: Idp
  beforeEach(async () => {
    listener = await startIdp()
  })
  afterEach(() => listener.close())

  const ISSUER = "https://idp.example.test/realm"

  it("ends the sign-in on the signed-out page, and sends the client's secret and the code nowhere", async () => {
    const document = {
      issuer: ISSUER,
      authorization_endpoint: `${listener.url}/auth`,
      token_endpoint: `${listener.url}/token`,
      revocation_endpoint: `${listener.url}/revoke`,
      jwks_uri: `${ISSUER}/keys`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    }
    const network = globalThis.fetch
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
      input.toString().startsWith(ISSUER)
        ? Promise.resolve(Response.json(document))
        : network(input, init),
    )
    const browser = new Browser(await bootWeb(oidcEnv(ISSUER)))
    const login = await browser.fetch("/app/auth/login")
    const location = String(login.headers.get("location"))
    // Had the login gone to the provider, its callback would exchange a code at the token endpoint.
    const state = new URL(location, ORIGIN).searchParams.get("state") ?? "none"
    await browser.fetch(`/app/auth/callback?code=the-code&state=${state}`)
    expect(location).toBe("/app/signed-out?reason=unavailable")
    expect(listener.paths).toEqual([])
    expect(discoveryLines()).toEqual([
      `[web-test] Web sign-in: the discovery of ${ISSUER} failed: the document cannot be used (endpoint-loopback). Until it answers, a sign-in ends on the signed-out page.`,
    ])
  })
})
