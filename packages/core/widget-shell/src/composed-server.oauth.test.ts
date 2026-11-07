import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
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

interface Realm {
  serverUrl: string
  /** An RS256 access token from this realm: its issuer, an hour's `exp`, then `claims`. */
  sign(claims: Record<string, unknown>): string
  close(): Promise<void>
}

/**
 * A loopback Keycloak realm that serves only its JWKS, so the Keycloak provider the env names runs
 * mcp-use's real JWT verifier against tokens this test signs.
 */
async function startRealm(): Promise<Realm> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return {
    serverUrl,
    sign(claims) {
      const exp = Math.floor(Date.now() / 1000) + 3600
      const body = { iss: `${serverUrl}/realms/platform`, exp, ...claims }
      const signed = `${segment({ alg: "RS256", kid: "k1", typ: "JWT" })}.${segment(body)}`
      const signature = crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey)
      return `${signed}.${signature.toString("base64url")}`
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
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
      "[oauth-test] OAuth needs MCP_URL, the server's public origin: tokens must carry <MCP_URL>/mcp in aud (RFC 8707).",
    )
  })

  // What the docs tell an IdP admin (docs/mcp/operations.md, the identity provider checklist),
  // held to the pinned mcp-use: an IdP set up for MCP_URL itself gets 401 on every call.
  describe("the token audience, against mcp-use's own JWT verifier", () => {
    let realm: Realm
    beforeEach(async () => {
      realm = await startRealm()
    })
    afterEach(() => realm.close())

    const bootRealm = () => {
      vi.stubEnv("MCP_URL", "http://localhost")
      return compose({
        env: {
          MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: realm.serverUrl,
          MCP_USE_OAUTH_KEYCLOAK_REALM: "platform",
          MCP_URL: "http://localhost",
        },
      })
    }

    it("logs the audience it accepts, MCP_URL's origin plus /mcp, which discovery advertises", async () => {
      const composed = await bootRealm()
      const infos = vi.mocked(console.info).mock.calls.map(([line]) => String(line))
      expect(infos).toContain(
        "[oauth-test] OAuth: tokens must carry aud http://localhost/mcp (RFC 8707) and a sub claim.",
      )
      const metadata = await composed.app.fetch(
        new Request("http://localhost/.well-known/oauth-protected-resource/mcp", {
          headers: { host: "localhost" },
        }),
      )
      expect(await metadata.json()).toMatchObject({ resource: "http://localhost/mcp" })
    })

    it("serves a token whose aud holds <MCP_URL>/mcp and refuses MCP_URL itself or no sub", async () => {
      const composed = await bootRealm()
      const call = (claims: Record<string, unknown>) =>
        initialize(composed, { authorization: `Bearer ${realm.sign(claims)}` })
      expect((await call({ aud: "http://localhost/mcp", sub: "u" })).status).toBe(200)
      expect((await call({ aud: ["account", "http://localhost/mcp"], sub: "u" })).status).toBe(200)
      // The 401 names an audience mismatch in its challenge; mcp-use's debug log does not.
      const debug = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.stubEnv("MCP_USE_OAUTH_DEBUG", "1")
      const wrongAudience = await call({ aud: "http://localhost", sub: "u" })
      expect(wrongAudience.status).toBe(401)
      expect(wrongAudience.headers.get("www-authenticate")).toContain(
        "Token audience does not include the protected resource",
      )
      expect(debug).not.toHaveBeenCalled()
      expect((await call({ aud: "http://localhost/mcp" })).status).toBe(401)
      const logged = debug.mock.calls.map(([line]) => String(line))
      expect(logged).toContain("[oauth-debug] claim=sub reason=missing")
    })
  })
})
