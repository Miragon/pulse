import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposedServer } from "./composed-server.js"
import { moduleOf } from "./composed-server.test-support.js"
import { JWK_RSA, now, resetIdp, sign, startIdp, type Idp } from "./oauth-jwt.test-support.js"

/**
 * Microsoft Entra ID on the boot for a token whose `aud` is `<MCP_URL>/mcp`: another app of the
 * tenant may own that App ID URI and get tokens for it, so `/mcp` takes it only where
 * `MCP_OAUTH_ENTRA_APP_ID_URI` names it, at a loopback authority whose key set is tagged as
 * Entra's.
 */

const PULSE = "https://pulse.example.test"
const TENANT = "4f1b6d0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b"
const API = "7d2e9c41-6b3f-4a8e-9f10-2b3c4d5e6f70"

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

let idp: Idp
beforeAll(async () => {
  idp = await startIdp()
})
afterAll(() => idp.close())

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  idp.sets[`/${TENANT}/discovery/v2.0/keys`] = {
    keys: [{ ...JWK_RSA, issuer: `${idp.url}/{tenantid}/v2.0` }],
  }
})

afterEach(() => {
  resetIdp(idp)
  vi.restoreAllMocks()
})

const boot = (env: NodeJS.ProcessEnv = {}) =>
  createComposedServer({
    info: { name: "entra-test", version: "0.0.0" },
    modules: [moduleOf({ name: "alpha", register: () => {} })],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {
      MCP_URL: PULSE,
      MCP_OAUTH_ENTRA_TENANT_ID: TENANT,
      MCP_OAUTH_ENTRA_API_CLIENT_ID: API,
      MCP_OAUTH_ENTRA_AUTHORITY: idp.url,
      ...env,
    },
  })

/** A v2 access token of the tenant with the API's scope, issued to an app other than Pulse's. */
const token = (claims: Record<string, unknown> = {}) =>
  sign({
    iss: `${idp.url}/${TENANT}/v2.0`,
    aud: API,
    ver: "2.0",
    scp: "user_impersonation",
    azp: "another-app",
    oid: "o-1",
    sub: "s-1",
    tid: TENANT,
    exp: now() + 3600,
    ...claims,
  })

async function initialize(composed: Awaited<ReturnType<typeof boot>>, bearer: string) {
  const answer = await composed.app.fetch(
    new Request(`${PULSE}/mcp`, {
      method: "POST",
      headers: {
        host: "pulse.example.test",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${bearer}`,
      },
      body: INITIALIZE,
    }),
  )
  return { status: answer.status, challenge: String(answer.headers.get("www-authenticate")) }
}

describe("Entra ID's gate for a token whose aud is <MCP_URL>/mcp", () => {
  it("refuses it unless MCP_OAUTH_ENTRA_APP_ID_URI names that URL, and serves the API's own", async () => {
    const resourceNamed = token({ aud: `${PULSE}/mcp` })
    const composed = await boot()
    const refused = await initialize(composed, resourceNamed)
    expect(refused.status).toBe(401)
    expect(refused.challenge).toContain("Token audience does not include the protected resource")
    expect((await initialize(composed, token())).status).toBe(200)
    const named = await boot({ MCP_OAUTH_ENTRA_APP_ID_URI: `api://${API},${PULSE}/mcp` })
    expect((await initialize(named, resourceNamed)).status).toBe(200)
  })
})
