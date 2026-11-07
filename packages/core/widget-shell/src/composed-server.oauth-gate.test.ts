import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"
import { createComposedServer, type ComposedServerOptions } from "./composed-server.js"
import { answer, moduleOf } from "./composed-server.test-support.js"
import { oauthCustomProvider } from "./oauth-providers.js"
import { getMcpRequestInfo } from "./request-context.js"

/** What the bearer gate lets through: one route, one credential, the one it verified. */

const KNOWN_TOKEN = "unit-token"

/** A network-free IdP that accepts exactly one token; installing it runs the real bearer gate. */
const stubOAuth = () =>
  oauthCustomProvider({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer: "https://idp.example.test",
      authorization_endpoint: "https://idp.example.test/a",
      token_endpoint: "https://idp.example.test/t",
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
            })
          : Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, "unknown token")),
    }),
    mapAuthInfo: () => ({ user: { id: "u" }, payload: { sub: "u" }, permissions: [] }),
  })

const seen: (string | undefined)[] = []

const probe = moduleOf({
  name: "probe",
  register: (server) =>
    server.registerTool("probe_seen", {}, () => {
      seen.push(getMcpRequestInfo()?.authorization)
      return answer()
    }),
})

const compose = (overrides: Partial<ComposedServerOptions> = {}) =>
  createComposedServer({
    info: { name: "oauth-gate-test", version: "0.0.0" },
    modules: [probe],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  })

type Composed = Awaited<ReturnType<typeof compose>>

const callProbe = (composed: Composed, headers: Record<string, string>, path = "/mcp") =>
  composed.app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "probe_seen", arguments: {} },
      }),
    }),
  )

beforeEach(() => {
  seen.length = 0
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Passthrough auth forwards what the hooks hand on, and the per-caller caches key on it: under
// OAuth that is the credential the gate verified, never a second one riding in the same header.
describe("createComposedServer: the credential behind the bearer gate", () => {
  it.each([
    ["a second Bearer credential", `Bearer ${KNOWN_TOKEN}, Bearer forged`],
    ["a second scheme", `Bearer ${KNOWN_TOKEN}, Basic Zm9yZ2Vk`],
    ["a trailing comma", `Bearer ${KNOWN_TOKEN},`],
  ])("refuses a header with %s after a valid token, before any handler", async (_case, header) => {
    const composed = await compose({ oauth: stubOAuth() })
    const refused = await callProbe(composed, { authorization: header })
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toContain(
      'error_description="The Authorization header must carry exactly one Bearer token"',
    )
    expect(seen).toEqual([])
  })

  it("hands the handlers the verified token, not what else the header carries", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    const res = await callProbe(composed, { authorization: `bearer ${KNOWN_TOKEN} trailing-junk` })
    expect(res.status).toBe(200)
    expect(seen).toEqual([`Bearer ${KNOWN_TOKEN}`])
  })

  // No gate, no caller: a gateway in front authenticated, and the header passes on as sent.
  it("hands the raw header on without OAuth", async () => {
    const composed = await compose()
    const res = await callProbe(composed, { authorization: "Bearer from-the-gateway" })
    expect(res.status).toBe(200)
    expect(seen).toEqual(["Bearer from-the-gateway"])
  })
})

describe("createComposedServer: OAuth and the path as sent", () => {
  // A percent-encoded alias of /mcp is no route at all: 404 with a token or without.
  it("answers an encoded alias of /mcp with 404, with or without a token", async () => {
    const composed = await compose({ oauth: stubOAuth() })
    expect((await callProbe(composed, {}, "/%6Dcp")).status).toBe(404)
    const withToken = await callProbe(
      composed,
      { authorization: `Bearer ${KNOWN_TOKEN}` },
      "/%6Dcp",
    )
    expect(withToken.status).toBe(404)
    expect(seen).toEqual([])
  })
})
