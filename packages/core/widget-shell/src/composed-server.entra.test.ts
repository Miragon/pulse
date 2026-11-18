import { decodeJwt } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposedServer } from "./composed-server.js"
import { moduleOf } from "./composed-server.test-support.js"
import {
  FAKE_OIDC_CLIENT,
  startFakeOidc,
  type FakeEntraTenant,
  type FakeOidc,
  type FakeOidcOptions,
} from "./testing/oidc/index.js"
import { entraSignIn } from "./testing/oidc/fake-oidc.test-support.js"
import { ENTRA_API_CLIENT_ID } from "./testing/oidc/realm.js"

/**
 * Microsoft Entra ID for one tenant (`MCP_OAUTH_ENTRA_*`) on the boot, at the fake tenant: the
 * documents it serves, its challenge and boot line, and its gate, which takes the tenant's v2
 * tokens for the API from either authority and refuses a token of another tenant, a Microsoft Graph
 * token, a v1 token (saying how to get v2 ones), an ID token and a token without the required
 * scope.
 */

const PULSE = "https://pulse.example.test"
const OTHER_TENANT = "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4"

const boot = (env: NodeJS.ProcessEnv) =>
  createComposedServer({
    info: { name: "entra-test", version: "0.0.0" },
    modules: [moduleOf({ name: "alpha", register: () => {} })],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env,
  })

type Composed = Awaited<ReturnType<typeof boot>>

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

const get = (composed: Composed, path: string) =>
  composed.app.fetch(new Request(`${PULSE}${path}`, { headers: { host: "pulse.example.test" } }))

const initialize = (composed: Composed, token?: string) =>
  composed.app.fetch(
    new Request(`${PULSE}/mcp`, {
      method: "POST",
      headers: {
        host: "pulse.example.test",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: INITIALIZE,
    }),
  )

const infos = () => vi.mocked(console.info).mock.calls.map(([line]) => String(line))

let fake: FakeOidc

const start = async (options: FakeOidcOptions = {}) => {
  fake = await startFakeOidc({ flavor: "entra", ...options })
}

const tenantOf = (): FakeEntraTenant => {
  if (fake.entra === undefined) throw new Error("no Entra ID tenant")
  return fake.entra
}

/** The API's scope as a client asks for it: the gate's required scope. */
const apiScope = () => `${tenantOf().appIdUris[0]}/${tenantOf().scope}`

/** What the web sign-in asks: a refresh token, the user's profile and the API's scope. */
const signedIn = (issuer?: string) =>
  entraSignIn(fake, {
    scopes: ["openid", "profile", "offline_access", apiScope()],
    ...(issuer === undefined ? {} : { issuer }),
  })

/** The gate's answer to `token`: its status and the challenge's text. */
async function answerTo(composed: Composed, token: string) {
  const answer = await initialize(composed, token)
  return { status: answer.status, challenge: String(answer.headers.get("www-authenticate")) }
}

/** The gate refuses `token` with 401, its challenge saying `why`. */
async function expectRefused(composed: Composed, token: string, why: string) {
  const { status, challenge } = await answerTo(composed, token)
  expect(status).toBe(401)
  expect(challenge).toContain(why)
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

describe("Entra ID on the boot: what it serves and says", () => {
  it("names the oauth21 authority and the full scope in the protected resource metadata, and serves no copy of the server's", async () => {
    await start()
    const composed = await boot(fake.env(PULSE))
    const metadata = await get(composed, "/.well-known/oauth-protected-resource/mcp")
    expect(await metadata.json()).toEqual({
      resource: `${PULSE}/mcp`,
      authorization_servers: [tenantOf().oauth21Issuer],
      scopes_supported: [apiScope()],
    })
    expect((await get(composed, "/.well-known/oauth-authorization-server")).status).toBe(404)
    expect(composed.boot.authenticated).toBe(true)
    const { tenant, apiClientId } = tenantOf()
    expect(infos()).toContain(
      `[entra-test] OAuth: tokens must carry iss ${fake.issuer} or ${tenantOf().oauth21Issuer}, aud ${apiClientId}, api://${apiClientId} or ${PULSE}/mcp (RFC 8707), ver 2.0, the scope ${apiScope()} and an oid or sub claim.`,
    )
    expect(fake.issuer).toBe(`${fake.serverUrl}/${tenant}/v2.0`)
  })

  it("challenges a request without a token with the resource's metadata and the full scope", async () => {
    await start()
    const composed = await boot(fake.env(PULSE))
    const answer = await initialize(composed)
    expect(answer.status).toBe(401)
    const challenge = String(answer.headers.get("www-authenticate"))
    expect(challenge).toContain(`scope="${apiScope()}"`)
    expect(challenge).toContain(
      `resource_metadata="${PULSE}/.well-known/oauth-protected-resource/mcp"`,
    )
  })
})

describe("Entra ID's gate at the fake tenant", () => {
  it("serves the tenant's v2 token of either authority", async () => {
    await start()
    const composed = await boot(fake.env(PULSE))
    const v2 = await signedIn()
    expect((await initialize(composed, v2.accessToken)).status).toBe(200)
    const oauth21 = await signedIn(tenantOf().oauth21Issuer)
    expect(decodeJwt(oauth21.accessToken).iss).toBe(tenantOf().oauth21Issuer)
    expect((await initialize(composed, oauth21.accessToken)).status).toBe(200)
  })

  it("refuses a token of another tenant", async () => {
    await start()
    const composed = await boot({ ...fake.env(PULSE), MCP_OAUTH_ENTRA_TENANT_ID: OTHER_TENANT })
    const { accessToken } = await signedIn()
    await expectRefused(composed, accessToken, 'error_description="JWT verification failed"')
  })

  it("refuses a Microsoft Graph token, which a sign-in that names no API scope gets", async () => {
    await start()
    const composed = await boot(fake.env(PULSE))
    const { accessToken } = await entraSignIn(fake, { scopes: ["openid", "profile"] })
    expect(decodeJwt(accessToken).aud).toBe("00000003-0000-0000-c000-000000000000")
    await expectRefused(
      composed,
      accessToken,
      "Token audience does not include the protected resource",
    )
  })

  it("refuses a v1 token, saying how the API gets v2 tokens", async () => {
    await start({ tokenVersion: 1 })
    const composed = await boot(fake.env(PULSE))
    const { accessToken } = await signedIn()
    expect(decodeJwt(accessToken)).toMatchObject({ ver: "1.0" })
    await expectRefused(
      composed,
      accessToken,
      "set requestedAccessTokenVersion to 2 in the API registration's manifest",
    )
  })

  it("refuses the sign-in's ID token, and one issued to the API's own registration", async () => {
    const apiClient = { id: ENTRA_API_CLIENT_ID, secret: "api-secret" }
    await start({ clients: [FAKE_OIDC_CLIENT, apiClient] })
    const composed = await boot(fake.env(PULSE))
    const { idToken } = await signedIn()
    await expectRefused(
      composed,
      String(idToken),
      "Token audience does not include the protected resource",
    )
    const own = await entraSignIn(fake, { scopes: ["openid", "profile"], client: apiClient })
    expect(decodeJwt(String(own.idToken)).aud).toBe(tenantOf().apiClientId)
    await expectRefused(composed, String(own.idToken), "Token carries no scp")
  })

  it("refuses a token without the required scope with 403, naming the scope", async () => {
    await start()
    const composed = await boot(fake.env(PULSE))
    const other = `${tenantOf().appIdUris[0]}/Other.Read`
    const { accessToken } = await entraSignIn(fake, { scopes: ["openid", other] })
    expect(decodeJwt(accessToken)).toMatchObject({ aud: tenantOf().apiClientId, scp: "Other.Read" })
    const { status, challenge } = await answerTo(composed, accessToken)
    expect(status).toBe(403)
    expect(challenge).toContain('error="insufficient_scope"')
    expect(challenge).toContain(`scope="${apiScope()}"`)
  })

  it("refuses a client its allowlist does not name", async () => {
    await start()
    const composed = await boot({ ...fake.env(PULSE), MCP_OAUTH_ENTRA_CLIENT_IDS: "claude" })
    const { accessToken } = await signedIn()
    await expectRefused(
      composed,
      accessToken,
      "Token was issued to a client this server does not accept",
    )
  })
})
