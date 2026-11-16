import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { oauthKeycloakProvider } from "../oauth-providers.js"
import { signIn as tokensOf } from "../testing/oidc/fake-oidc.test-support.js"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { SESSION_COOKIE } from "./cookies.js"
import { bootWeb, Browser, RESOURCE, signIn, webEnv } from "./sign-in.test-support.js"

let fake: FakeOidc
let logged: MockInstance<(...data: unknown[]) => void>

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  vi.spyOn(console, "info").mockImplementation(() => {})
  logged = vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

/** A tools/call of the probe at /mcp, with `headers` and the browser's cookies. */
const toolsCall = (browser: Browser, headers: Record<string, string>) =>
  browser.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "probe_tool", arguments: {} },
    }),
  })

const COOKIE_AT_MCP = "This endpoint takes a bearer token, never the web app's session cookie."

/** The gate's challenge, so a client finds the authorization server as it does without a token. */
const CHALLENGE = `Bearer error="invalid_token", error_description="${COOKIE_AT_MCP}", resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"`

describe("the separation of the session cookie and the bearer token", () => {
  it("answers a call at /mcp that carries the session cookie with 401, a valid bearer token too", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const { accessToken } = await tokensOf(fake)
    const bearer = { authorization: `Bearer ${accessToken}` }
    expect((await toolsCall(browser, bearer)).status).toBe(200)
    await signIn(browser, fake)
    const refused = await toolsCall(browser, bearer)
    expect(refused.status).toBe(401)
    expect(refused.headers.get("cache-control")).toBe("no-store")
    expect(refused.headers.get("www-authenticate")).toBe(CHALLENGE)
    expect(await refused.json()).toEqual({
      error: "invalid_token",
      error_description: COOKIE_AT_MCP,
    })
  })

  it("names the scopes the gate requires in the challenge to the cookie at /mcp", async () => {
    const provider = {
      ...oauthKeycloakProvider({ serverUrl: fake.serverUrl, realm: fake.realm }),
      requiredScopes: ["mcp:tools", "profile"],
    }
    const browser = new Browser(await bootWeb(webEnv(fake), { oauth: provider }))
    browser.cookies.set(SESSION_COOKIE, "x")
    const refused = await toolsCall(browser, {})
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toBe(
      CHALLENGE.replace(", resource_metadata", ', scope="mcp:tools profile", resource_metadata'),
    )
  })

  it.each([SESSION_COOKIE, `${SESSION_COOKIE}.1`, `${SESSION_COOKIE}.2`])(
    "refuses the cookie %s at /mcp, whatever it holds",
    async (name) => {
      const browser = new Browser(await bootWeb(webEnv(fake)))
      browser.cookies.set(name, "x")
      expect((await toolsCall(browser, {})).status).toBe(401)
    },
  )

  it("leaves /mcp to the gate without the cookie, and other cookies to it too", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    browser.cookies.set(`${SESSION_COOKIE}x`, "x")
    browser.cookies.set("__Host-pulse-login", "x")
    const response = await toolsCall(browser, {})
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
  })

  it.each([
    ["/app/auth/login", "GET"],
    ["/app/auth/callback", "GET"],
    ["/app/auth/logout", "POST"],
    ["/app/api/session", "GET"],
    ["/app", "GET"],
    ["/app/boards/ops", "GET"],
  ])(
    "answers %s with 400 to a request that carries an Authorization header",
    async (path, method) => {
      const browser = new Browser(await bootWeb(webEnv(fake)))
      const response = await browser.fetch(path, {
        method,
        headers: { authorization: "Bearer anything", origin: "http://localhost" },
      })
      expect(response.status).toBe(400)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.json()).toEqual({
        message:
          "Bad request: the web app takes its session cookie, never an Authorization header.",
      })
      expect(fake.requests).toEqual([])
    },
  )

  it("leaves a bearer token on other routes alone", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const response = await browser.fetch("/apple", { headers: { authorization: "Bearer x" } })
    expect(response.status).toBe(404)
  })

  it("answers every route of the sign-in and the API no-store, a 404 included", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    for (const path of ["/app/api/nothing", "/app/auth/nothing", "/app/auth"]) {
      const response = await browser.fetch(path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get("cache-control"), path).toBe("no-store")
    }
    expect((await browser.fetch("/app/nothing")).headers.get("cache-control")).toBeNull()
  })

  it("installs nothing without MCP_WEB_CLIENT_ID: no /app, and /mcp as before", async () => {
    const env = webEnv(fake)
    for (const name of ["MCP_WEB_CLIENT_ID", "MCP_WEB_CLIENT_SECRET", "MCP_WEB_SESSION_KEYS"]) {
      delete env[name]
    }
    const browser = new Browser(await bootWeb(env))
    expect((await browser.fetch("/app/auth/login")).status).toBe(404)
    expect((await browser.fetch("/app/api/session")).status).toBe(404)
    browser.cookies.set(SESSION_COOKIE, "x")
    const { accessToken } = await tokensOf(fake)
    const answered = await toolsCall(browser, { authorization: `Bearer ${accessToken}` })
    expect(answered.status).toBe(200)
    // The request log reads a streamed answer once it ended: let it, before the spies go.
    await answered.text()
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        expect.stringMatching(/^tools\/call probe_tool \/mcp 200/),
      ),
    )
  })
})
