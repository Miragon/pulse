import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposedServer, type ComposedServerOptions } from "./composed-server.js"
import { moduleOf, stubOAuth } from "./composed-server.test-support.js"

/**
 * The discovery documents the boot serves beside the bearer gate: the protected resource
 * metadata always, with the provider's required scopes, and the copy of the authorization
 * server's metadata only for a provider whose metadata names its endpoints.
 */

const KEYCLOAK_ENV = {
  MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_OAUTH_KEYCLOAK_REALM: "platform",
}

const compose = (overrides: Partial<ComposedServerOptions> = {}) =>
  createComposedServer({
    info: { name: "oauth-test", version: "0.0.0" },
    modules: [moduleOf({ name: "alpha", register: () => {} })],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  })

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

const infos = () => vi.mocked(console.info).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
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

  // The table providers keep their documents and their boot line byte for byte.
  it("serves a table provider's documents as they were, and logs its boot line", async () => {
    const composed = await compose({ env: { ...KEYCLOAK_ENV, MCP_URL: "http://localhost" } })
    const issuer = "https://kc.example.com/realms/platform"
    const resource = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await resource.text()).toBe(
      `{"resource":"http://localhost/mcp","authorization_servers":["${issuer}"]}`,
    )
    const server = await fetchApp(composed, "/.well-known/oauth-authorization-server")
    expect(await server.text()).toBe(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        registration_endpoint: `${issuer}/clients-registrations/openid-connect`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
      }),
    )
    expect(composed.app.allowedMethods("/.well-known/oauth-authorization-server")).toBe(
      "GET, HEAD, OPTIONS",
    )
    expect(infos()).toContain(
      "[oauth-test] OAuth: tokens must carry aud http://localhost/mcp (RFC 8707) and a sub claim.",
    )
  })

  it("names a provider's required scopes in scopes_supported, never offline_access", async () => {
    const oauth = { ...stubOAuth(), requiredScopes: ["mcp:read", "offline_access"] }
    const composed = await compose({ oauth })
    const resource = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await resource.json()).toEqual({
      resource: "http://localhost/mcp",
      authorization_servers: ["https://idp.example.test"],
      scopes_supported: ["mcp:read"],
    })
  })

  // Clients since MCP 2025-06-18 read the provider's own metadata; a copy without its endpoints
  // would mislead an older one.
  it("answers 404 for the authorization server's copy of a provider that names its issuer alone", async () => {
    const oauth = {
      ...stubOAuth(),
      oauthMetadata: { issuer: "https://idp.example.test" },
      describeAudience: (resource: URL) => `aud ${resource.href} or api://pulse`,
      describeCaller: () => "an oid or sub claim",
    }
    const composed = await compose({ oauth })
    expect((await fetchApp(composed, "/.well-known/oauth-authorization-server")).status).toBe(404)
    expect(composed.app.allowedMethods("/.well-known/oauth-authorization-server")).toBe("")
    const resource = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await resource.json()).toEqual({
      resource: "http://localhost/mcp",
      authorization_servers: ["https://idp.example.test"],
    })
    expect(infos()).toContain(
      "[oauth-test] OAuth: tokens must carry aud http://localhost/mcp or api://pulse and an oid or sub claim.",
    )
  })

  it("serves no discovery without OAuth", async () => {
    const composed = await compose()
    const res = await fetchApp(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(res.status).toBe(404)
  })
})
