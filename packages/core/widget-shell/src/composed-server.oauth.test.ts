import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"
import { oauthCustomProvider } from "./oauth-providers.js"
import type { ComposableModule } from "./composition.js"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
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

/** A network-free IdP that accepts exactly one token; installing it runs the real bearer gate. */
const KNOWN_TOKEN = "unit-token"
const stubOAuth = (issuer = "https://idp.example.test") =>
  oauthCustomProvider({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer,
      authorization_endpoint: `${issuer}/a`,
      token_endpoint: `${issuer}/t`,
      response_types_supported: ["code"],
    },
    createTokenVerifier: (resource: URL) => ({
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
  MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_OAUTH_KEYCLOAK_REALM: "platform",
}

interface Realm {
  serverUrl: string
  /** Answer the key set with a 500 from now on. */
  fail(): void
  /** An RS256 access token from this realm: its issuer, an hour's `exp`, then `claims`. */
  sign(claims: Record<string, unknown>): string
  close(): Promise<void>
}

/**
 * A loopback Keycloak realm that serves only its JWKS, so the Keycloak provider the env names runs
 * the real JWT verifier against tokens this test signs.
 */
async function startRealm(): Promise<Realm> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }
  let failing = false
  const server = http.createServer((_req, res) => {
    if (failing) {
      res.statusCode = 500
      return res.end("down")
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return {
    serverUrl,
    fail: () => {
      failing = true
    },
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

const running: RunningServer[] = []
let log: MockInstance<(line: string) => void>

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  log = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
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

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "unit", version: "0" },
  },
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
      body: INITIALIZE,
    }),
  )

const fetchApp = (
  composed: { app: { fetch: (r: Request) => Promise<Response> } },
  path: string,
  init: RequestInit = {},
) =>
  composed.app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { host: "localhost", ...(init.headers as Record<string, string>) },
    }),
  )

describe("createComposedServer: OAuth", () => {
  it("builds the OAuth provider the env names: /mcp answers 401 with a Bearer challenge, and the boot is authenticated", async () => {
    const composed = await compose({ env: { ...KEYCLOAK_ENV, MCP_URL: "http://localhost" } })
    expect(composed.boot.authenticated).toBe(true)
    expect(composed.boot.entries[0].config).toMatchObject({ toolset: "operations" })
    const res = await initialize(composed)
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /)
  })

  it("installs the root's provider instead of reading the env, and authenticates the boot", async () => {
    // Keycloak AND Auth0 in the env would fail the boot if it read them.
    const env = { ...KEYCLOAK_ENV, MCP_OAUTH_AUTH0_DOMAIN: "tenant.auth0.com" }
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
    await expect(compose({ env: { MCP_OAUTH_KEYCLOAK_REALM: "platform" } })).rejects.toThrow(
      "Keycloak OAuth needs MCP_OAUTH_KEYCLOAK_SERVER_URL and MCP_OAUTH_KEYCLOAK_REALM, but MCP_OAUTH_KEYCLOAK_SERVER_URL is unset.",
    )
    expect(createPlugin).not.toHaveBeenCalled()
  })

  // No provider's variable is set, so nothing asks for OAuth; the log is what says so.
  it.each(["MCP_OAUH_KEYCLOAK_SERVER_URL", "MCP_OAUTH"])(
    "boots without OAuth on %s, no provider's variable, and warns about both",
    async (name) => {
      const composed = await compose({ env: { [name]: "https://kc.example.com" } })
      expect(composed.boot.authenticated).toBe(false)
      const warnings = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
      expect(warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`Unknown environment variable "${name}"`),
          expect.stringContaining("No OAuth provider is configured"),
        ]),
      )
    },
  )

  it("fails the boot when OAuth has no resource and MCP_URL is unset", async () => {
    const oauth = { resource: undefined } as unknown as ComposedServerOptions["oauth"]
    await expect(compose({ oauth })).rejects.toThrow(
      "[oauth-test] OAuth needs MCP_URL, the server's public origin: tokens must carry <MCP_URL>/mcp in aud (RFC 8707).",
    )
  })

  // Discovery could not advertise it: the boot fails, not every discovery request.
  it("fails the boot on an issuer that is plain HTTP off loopback", async () => {
    await expect(compose({ oauth: stubOAuth("http://idp.internal") })).rejects.toThrow(
      'OAuth issuer "http://idp.internal/" cannot be advertised in discovery: Issuer URL must be HTTPS',
    )
  })
})

describe("createComposedServer: OAuth behind the edge", () => {
  it("answers a foreign Host from the guard before the bearer gate", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const foreign = await initialize(composed, { host: "attacker.example" })
    expect(foreign.status).toBe(403)
    expect(foreign.headers.get("www-authenticate")).toBeNull()
    expect(await foreign.text()).toContain('Host \\"attacker.example\\" is not allowed')
  })

  it("refuses a foreign Origin's POST even with a valid token", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const res = await initialize(composed, {
      authorization: `Bearer ${KNOWN_TOKEN}`,
      origin: "https://attacker.example",
    })
    expect(res.status).toBe(403)
  })

  // The listener refuses the body before any route, the bearer gate included.
  it("answers a body over the 4 MiB default with 413 before the bearer gate", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const server = await composed.listen({ port: 0, host: "127.0.0.1" })
    running.push(server)
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: "/mcp",
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-length": String(4 * 1024 * 1024 + 1),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
            req.destroy()
          })
        },
      )
      req.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET" && error.code !== "EPIPE") reject(error)
      })
      req.write("{")
    })
    expect(answer.status).toBe(413)
    expect(answer.body).toContain("exceeds 4194304 bytes (MCP_MAX_BODY_BYTES)")
  })
})

describe("createComposedServer: OAuth discovery", () => {
  it("serves both documents, answers a preflight from any origin and refuses other methods", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const resource = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await resource.json()).toEqual({
      resource: "http://localhost/mcp",
      authorization_servers: ["https://idp.example.test"],
    })
    const server = await fetchApp(composed, "/.well-known/oauth-authorization-server")
    expect(await server.json()).toMatchObject({ issuer: "https://idp.example.test" })
    const preflight = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://claude.ai",
        "access-control-request-method": "GET",
        "access-control-request-headers": "mcp-protocol-version",
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*")
    expect(preflight.headers.get("access-control-allow-headers")).toBe("mcp-protocol-version")
    const posted = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp", {
      method: "POST",
      body: "{}",
    })
    expect(posted.status).toBe(405)
    expect(posted.headers.get("allow")).toBe("GET, HEAD, OPTIONS")
    expect((await fetchApp(composed, "/.well-known/openid-configuration")).status).toBe(404)
  })

  it("serves no discovery without OAuth", async () => {
    const composed = await compose()
    const res = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(res.status).toBe(404)
  })
})

// What the docs tell an IdP admin (docs/mcp/operations.md, the identity provider checklist):
// an IdP set up for MCP_URL itself gets 401 on every call.
describe("the token audience, against the real JWT verifier", () => {
  let realm: Realm
  beforeEach(async () => {
    realm = await startRealm()
  })
  afterEach(() => realm.close())

  const bootRealm = (env: NodeJS.ProcessEnv = {}) =>
    compose({
      env: {
        MCP_OAUTH_KEYCLOAK_SERVER_URL: realm.serverUrl,
        MCP_OAUTH_KEYCLOAK_REALM: "platform",
        MCP_URL: "http://localhost",
        ...env,
      },
    })

  it("logs the audience it accepts, MCP_URL's origin plus /mcp, which discovery advertises", async () => {
    const composed = await bootRealm()
    const infos = vi.mocked(console.info).mock.calls.map(([line]) => String(line))
    expect(infos).toContain(
      "[oauth-test] OAuth: tokens must carry aud http://localhost/mcp (RFC 8707) and a sub claim.",
    )
    const metadata = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await metadata.json()).toMatchObject({ resource: "http://localhost/mcp" })
  })

  it("serves a token whose aud holds <MCP_URL>/mcp and refuses MCP_URL itself or no sub", async () => {
    const composed = await bootRealm()
    const call = (claims: Record<string, unknown>) =>
      initialize(composed, { authorization: `Bearer ${realm.sign(claims)}` })
    expect((await call({ aud: "http://localhost/mcp", sub: "u" })).status).toBe(200)
    expect((await call({ aud: ["account", "http://localhost/mcp"], sub: "u" })).status).toBe(200)
    const wrongAudience = await call({ aud: "http://localhost", sub: "u" })
    expect(wrongAudience.status).toBe(401)
    expect(wrongAudience.headers.get("www-authenticate")).toContain(
      "Token audience does not include the protected resource",
    )
    expect((await call({ aud: "http://localhost/mcp" })).status).toBe(401)
  })

  // A malformed claim is refused whole, even when one of its strings names this server.
  it.each([
    ["an array that mixes in a number", [1, "http://localhost/mcp"]],
    ["an array that mixes in null", ["http://localhost/mcp", null]],
    ["an array that mixes in an object", [{ aud: "x" }, "http://localhost/mcp"]],
    ["an empty array", []],
    ["a number", 1],
  ])("refuses an aud that is %s", async (_case, aud) => {
    const composed = await bootRealm()
    const refused = await initialize(composed, {
      authorization: `Bearer ${realm.sign({ aud, sub: "u" })}`,
    })
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toContain(
      "Token audience claim must be a string or string array",
    )
  })

  it("logs why a token was refused with MCP_OAUTH_DEBUG from the boot's env, and only then", async () => {
    const debug = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const off of ["0", "false", " "]) {
      const quiet = await bootRealm({ MCP_OAUTH_DEBUG: off })
      await initialize(quiet, { authorization: `Bearer ${realm.sign({ aud: "x", sub: "u" })}` })
    }
    expect(debug).not.toHaveBeenCalled()
    const loud = await bootRealm({ MCP_OAUTH_DEBUG: "1" })
    await initialize(loud, {
      authorization: `Bearer ${realm.sign({ aud: "http://localhost/mcp" })}`,
    })
    const logged = debug.mock.calls.map(([line]) => String(line))
    expect(logged).toContain("[oauth-debug] claim=sub reason=missing")
  })

  it("answers 503 naming the key set when the IdP cannot deliver it, and logs the reason", async () => {
    const composed = await bootRealm()
    realm.fail()
    const res = await initialize(composed, {
      authorization: `Bearer ${realm.sign({ aud: "http://localhost/mcp", sub: "u" })}`,
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string; error_description: string }
    expect(body.error).toBe("temporarily_unavailable")
    expect(body.error_description).toContain(
      `could not be loaded from ${realm.serverUrl}/realms/platform/protocol/openid-connect/certs`,
    )
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^initialize unit\/0 \/mcp 503 client=unit\/0 \d+ms ERROR temporarily_unavailable: The identity provider's signing keys could not be loaded/,
        ),
      ),
    )
  })
})
