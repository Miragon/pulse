import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OAuthError, OAuthErrorCode, oauthCustomProvider } from "mcp-use/oauth"
import type { ComposableModule } from "./composition.js"
import { createComposedServer, type ComposedServerOptions } from "./composed-server.js"
import { createToolsetVocabulary } from "./toolsets.js"

const createPlugin = vi.fn(() => ({ name: "alpha", register: () => {} }))

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  toolsets: createToolsetVocabulary("alpha", ["read-only", "operations"] as const, "read-only", {
    authenticatedDefault: "operations",
  }),
  createPlugin,
}

/** A network-free IdP that accepts exactly one token; installing it runs mcp-use's real bearer gate. */
const KNOWN_TOKEN = "unit-token"
const stubOAuth = () =>
  oauthCustomProvider<unknown>({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer: "https://idp.example.test",
      authorization_endpoint: "https://idp.example.test/a",
      token_endpoint: "https://idp.example.test/t",
      response_types_supported: ["code"],
    },
    createTokenVerifier: (resource) => ({
      verifyAccessToken: (token: string) =>
        token === KNOWN_TOKEN
          ? Promise.resolve({
              token,
              clientId: "unit",
              scopes: [],
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              resource,
              extra: { sub: "u" },
            })
          : Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, "unknown token")),
    }),
    mapAuthInfo: () => ({ user: { id: "u" }, payload: { sub: "u" }, permissions: [] }),
  })

const KEYCLOAK_ENV = {
  MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_USE_OAUTH_KEYCLOAK_REALM: "platform",
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  createPlugin.mockClear()
})

const compose = (overrides: Partial<ComposedServerOptions> = {}) =>
  createComposedServer({
    info: { name: "oauth-test", version: "0.0.0" },
    modules: [alpha],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  })

/** An MCP `initialize` straight into the app (no socket), from a Host the edge allows. */
const initialize = (
  composed: { app: { fetch: (r: Request) => Promise<Response> } },
  headers: Record<string, string> = {},
) =>
  composed.app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "unit", version: "0" },
        },
      }),
    }),
  )

describe("createComposedServer: OAuth", () => {
  it("builds the OAuth provider the env names: /mcp answers 401 with a Bearer challenge, and the boot is authenticated", async () => {
    // mcp-use reads MCP_URL (the token audience) from process.env itself.
    vi.stubEnv("MCP_URL", "http://localhost")
    const composed = await compose({ env: { ...KEYCLOAK_ENV, MCP_URL: "http://localhost" } })
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.entries[0].config).toMatchObject({ toolset: "operations" })
    const res = await initialize(composed)
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /)
  })

  it("installs the root's provider instead of reading the env, and authenticates the boot", async () => {
    // Keycloak AND Auth0 in the env would fail the boot if it read them.
    const env = { ...KEYCLOAK_ENV, MCP_USE_OAUTH_AUTH0_DOMAIN: "tenant.auth0.com" }
    const composed = await compose({ oauth: stubOAuth(), env })
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.entries[0].config).toMatchObject({ toolset: "operations" })
  })

  it("answers 401 on /mcp without a bearer token and serves a known one", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    expect((await initialize(composed)).status).toBe(401)
    const served = await initialize(composed, { authorization: `Bearer ${KNOWN_TOKEN}` })
    expect(served.status).toBe(200)
  })

  // The warning's wording is oauth-env's; the boot warns once, under its own name.
  it("counts a boot without a provider as unauthenticated, warning once under its name", async () => {
    const composed = await compose()
    expect(composed.boot.authenticated).toBe(false)
    expect(composed.boot.entries[0].config).toMatchObject({ toolset: "read-only" })
    const warnings = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(warnings.filter((line) => line.includes("OAuth"))).toEqual([
      expect.stringMatching(/^\[oauth-test\] /),
    ])
    expect((await initialize(composed)).status).toBe(200)
  })

  it("fails the boot on an OAuth config it cannot honor, before any plugin is created", async () => {
    await expect(compose({ env: { MCP_USE_OAUTH_KEYCLOAK_REALM: "platform" } })).rejects.toThrow(
      "Keycloak OAuth needs MCP_USE_OAUTH_KEYCLOAK_SERVER_URL and MCP_USE_OAUTH_KEYCLOAK_REALM, but MCP_USE_OAUTH_KEYCLOAK_SERVER_URL is unset.",
    )
    expect(createPlugin).not.toHaveBeenCalled()
  })

  it("fails the boot when OAuth has no resource and MCP_URL is unset", async () => {
    const oauth = { resource: undefined } as unknown as ComposedServerOptions["oauth"]
    await expect(compose({ oauth })).rejects.toThrow(
      "[oauth-test] OAuth needs MCP_URL, the server's public base URL, which is also the token audience (RFC 8707).",
    )
  })
})
