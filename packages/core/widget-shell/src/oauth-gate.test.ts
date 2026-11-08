import { afterEach, describe, expect, it, vi } from "vitest"
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server"
import {
  oauthDiscovery,
  oauthGate,
  resolveOAuthResource,
  toolResultChallenge,
} from "./oauth-gate.js"
import {
  oauthCustomProvider,
  oauthKeycloakProvider,
  type OAuthProvider,
} from "./oauth-providers.js"

/** The gate in front of `/mcp` around a custom provider, discovery, the resource, the challenge. */

const RESOURCE = new URL("http://localhost/mcp")
const AUD = RESOURCE.href
const now = () => Math.floor(Date.now() / 1000)

afterEach(() => {
  vi.restoreAllMocks()
})

const gateOf = (provider: OAuthProvider, onUnexpected = vi.fn()) =>
  oauthGate(provider, RESOURCE, onUnexpected)

const call = (gate: ReturnType<typeof gateOf>, authorization?: string) =>
  gate(
    new Request(AUD, {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    }),
  )

/** The refusal's status and the description its body (and challenge) carries. */
async function refusal(result: AuthInfo | Response) {
  expect(result).toBeInstanceOf(Response)
  const response = result as Response
  const body = (await response.json()) as { error: string; error_description: string }
  return { status: response.status, error: body.error, description: body.error_description }
}

const keycloak = () => oauthKeycloakProvider({ serverUrl: "https://kc.example.com", realm: "a" })

describe("the bearer gate: a custom provider", () => {
  const custom = (overrides: Partial<OAuthProvider> = {}): OAuthProvider =>
    oauthCustomProvider({
      oauthMetadata: {
        issuer: "https://idp.example",
        authorization_endpoint: "https://idp.example/a",
        token_endpoint: "https://idp.example/t",
        response_types_supported: ["code"],
      },
      createTokenVerifier: (resource) => ({
        verifyAccessToken: (token) =>
          Promise.resolve({
            token,
            clientId: "c",
            scopes: token === "scoped" ? ["mcp"] : [],
            expiresAt: now() + 60,
            resource,
          }),
      }),
      mapAuthInfo: () => ({ user: { id: "u" }, payload: { sub: "u" }, permissions: [] }),
      ...overrides,
    })

  it("answers 403 insufficient_scope for a token without a required scope", async () => {
    const gate = gateOf(custom({ requiredScopes: ["mcp"] }))
    expect(await call(gate, "Bearer scoped")).not.toBeInstanceOf(Response)
    const refused = (await call(gate, "Bearer plain")) as Response
    expect(refused.status).toBe(403)
    expect(refused.headers.get("www-authenticate")).toContain('error="insufficient_scope"')
    expect(refused.headers.get("www-authenticate")).toContain('scope="mcp"')
  })

  it("refuses a token its verifier binds to another resource, or to none", async () => {
    for (const resource of [new URL("https://other.example/mcp"), undefined]) {
      const provider = custom({
        createTokenVerifier: () => ({
          verifyAccessToken: (token) =>
            Promise.resolve({ token, clientId: "c", scopes: [], expiresAt: now() + 60, resource }),
        }),
      })
      expect((await refusal(await call(gateOf(provider), "Bearer t"))).description).toBe(
        "Token resource does not match the protected resource",
      )
    }
  })

  it("refuses a token whose identity mapping fails", async () => {
    const provider = custom({
      mapAuthInfo: () => {
        throw new Error("no user")
      },
    })
    expect((await refusal(await call(gateOf(provider), "Bearer t"))).description).toBe(
      "Token identity mapping failed",
    )
  })

  it("answers 503 when the verifier says it cannot verify now", async () => {
    const provider = custom({
      createTokenVerifier: () => ({
        verifyAccessToken: () =>
          Promise.reject(new OAuthError(OAuthErrorCode.TemporarilyUnavailable, "IdP down")),
      }),
    })
    const response = (await call(gateOf(provider), "Bearer t")) as Response
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("answers a verifier's bug with a plain 500 and hands it to onUnexpected", async () => {
    const bug = new TypeError("boom")
    const provider = custom({
      createTokenVerifier: () => ({ verifyAccessToken: () => Promise.reject(bug) }),
    })
    const onUnexpected = vi.fn()
    const response = (await call(gateOf(provider, onUnexpected), "Bearer t")) as Response
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "server_error",
      error_description: "Internal Server Error",
    })
    expect(onUnexpected).toHaveBeenCalledExactlyOnceWith(bug)
  })

  it("requires a verifier, a mapping and a string issuer", () => {
    const base = custom()
    expect(() => oauthCustomProvider({ ...base, createTokenVerifier: undefined } as never)).toThrow(
      "oauthCustomProvider requires createTokenVerifier and mapAuthInfo",
    )
    expect(() => oauthCustomProvider({ ...base, mapAuthInfo: undefined } as never)).toThrow(
      "oauthCustomProvider requires createTokenVerifier and mapAuthInfo",
    )
    expect(() =>
      oauthCustomProvider({
        ...base,
        oauthMetadata: { ...base.oauthMetadata, issuer: 7 },
      } as never),
    ).toThrow("oauthMetadata must include a string issuer")
  })
})

describe("discovery and the resource", () => {
  const provider = (issuer: string) => ({
    ...keycloak(),
    oauthMetadata: { ...keycloak().oauthMetadata, issuer },
  })

  it("validates the issuer once: HTTPS, or HTTP on a loopback name", () => {
    expect(oauthDiscovery(provider("https://kc.example.com/realms/a"), RESOURCE)).toMatchObject({
      dangerouslyAllowInsecureIssuerUrl: false,
    })
    for (const issuer of [
      "http://127.0.0.1:1/realms/a",
      "http://[::1]:1/x",
      "http://kc.localhost/x",
    ]) {
      expect(oauthDiscovery(provider(issuer), RESOURCE), issuer).toMatchObject({
        dangerouslyAllowInsecureIssuerUrl: true,
      })
    }
    expect(() => oauthDiscovery(provider("http://kc.internal/realms/a"), RESOURCE)).toThrow(
      "Issuer URL must be HTTPS",
    )
    expect(() => oauthDiscovery(provider("https://kc.example.com/?a=1"), RESOURCE)).toThrow(
      "must not have a query string",
    )
    expect(() => oauthDiscovery(provider("kc"), RESOURCE)).toThrow(
      'OAuth issuer "kc" is not an absolute URL',
    )
  })

  it("binds tokens to the explicit resource, else MCP_URL's origin plus the base path", () => {
    const base = keycloak()
    expect(resolveOAuthResource(base, " https://mcp.example.com ", "/mcp").href).toBe(
      "https://mcp.example.com/mcp",
    )
    expect(
      resolveOAuthResource({ ...base, resource: "http://localhost:8400/mcp/" }, undefined, "/mcp")
        .href,
    ).toBe("http://localhost:8400/mcp")
  })

  it.each<[string, Partial<OAuthProvider>, string | undefined, string]>([
    ["no resource and no MCP_URL", {}, undefined, "OAuth needs an explicit resource or MCP_URL."],
    [
      "an MCP_URL with a path",
      {},
      "https://mcp.example.com/base",
      "MCP_URL must be an absolute origin without a path",
    ],
    [
      "plain HTTP off loopback",
      { resource: "http://mcp.example.com/mcp" },
      undefined,
      "OAuth resource must use HTTPS, or HTTP for localhost",
    ],
    [
      "another path",
      { resource: "https://mcp.example.com/api" },
      undefined,
      "OAuth resource path must exactly match basePath (/mcp)",
    ],
  ])("refuses %s", (_case, overrides, mcpUrl, message) => {
    expect(() => resolveOAuthResource({ ...keycloak(), ...overrides }, mcpUrl, "/mcp")).toThrow(
      message,
    )
  })
})

describe("toolResultChallenge: ChatGPT reads a refused tools/call as a tool result", () => {
  const refusalOf = (body: string, header: string | null = 'Bearer error="invalid_token"') =>
    new Response(body, {
      status: 401,
      headers: header === null ? {} : { "www-authenticate": header },
    })
  const requestOf = (body: unknown, userAgent = "openai-mcp/1.0") =>
    new Request(AUD, {
      method: "POST",
      headers: { "user-agent": userAgent },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  const toolsCall = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "x" } }

  it("answers a JSON-RPC result carrying the challenge and the description", async () => {
    const answer = await toolResultChallenge(
      requestOf(toolsCall),
      refusalOf(JSON.stringify({ error: "invalid_token", error_description: "Token expired" })),
    )
    expect(await answer?.json()).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: {
        content: [{ type: "text", text: "Token expired" }],
        isError: true,
        _meta: { "mcp/www_authenticate": ['Bearer error="invalid_token"'] },
      },
    })
  })

  it("marks a modern request's result complete, and says authentication is required without a description", async () => {
    const modern = {
      ...toolsCall,
      params: { name: "x", _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
    }
    const answer = await toolResultChallenge(requestOf(modern), refusalOf("not json", null))
    expect(await answer?.json()).toMatchObject({
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "Authentication is required." }],
        _meta: { "mcp/www_authenticate": [] },
      },
    })
  })

  it.each<[string, Request]>([
    ["another client", requestOf(toolsCall, "claude-code/2.1")],
    ["another method", requestOf({ ...toolsCall, method: "tools/list" })],
    ["a notification", requestOf({ ...toolsCall, id: undefined })],
    ["a body that is no JSON", requestOf("{nope")],
  ])("leaves %s to the 401", async (_case, request) => {
    expect(await toolResultChallenge(request, refusalOf("{}"))).toBeUndefined()
  })
})
