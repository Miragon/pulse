import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposedServer } from "./composed-server.js"
import { moduleOf } from "./composed-server.test-support.js"
import { now, sign, startIdp, type Idp } from "./oauth-jwt.test-support.js"
import { FAKE_OIDC_CLIENT, startFakeOidc, type FakeOidc } from "./testing/oidc/index.js"
import { requestToken } from "@miragon/pulse-http/oauth"
import {
  metadataOf,
  platform,
  signIn,
  tokenEndpointOf,
} from "./testing/oidc/fake-oidc.test-support.js"

/**
 * The generic OpenID Connect provider (`MCP_OAUTH_OIDC_*`) on the boot: the documents it serves,
 * its boot line, and its gate over the provider's discovery, at the fake ADFS and at a loopback
 * provider whose discovery the test breaks.
 */

/** The origin `fake-oidc.test-support`'s sign-in names its resource under. */
const PULSE = "https://pulse.example.test"

const boot = (env: NodeJS.ProcessEnv) =>
  createComposedServer({
    info: { name: "oidc-test", version: "0.0.0" },
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

/** A request to the app at `origin`, from its own Host. */
const fetchAt = (composed: Composed, origin: string, path: string, headers = {}, body?: string) =>
  composed.app.fetch(
    new Request(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        host: new URL(origin).host,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", accept: "application/json, text/event-stream" }),
        ...headers,
      },
      body,
    }),
  )

const initialize = (composed: Composed, origin: string, token: string) =>
  fetchAt(composed, origin, "/mcp", { authorization: `Bearer ${token}` }, INITIALIZE)

const infos = () => vi.mocked(console.info).mock.calls.map(([line]) => String(line))
const warnings = () => vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the generic provider at ADFS", () => {
  let adfs: FakeOidc
  beforeEach(async () => {
    adfs = await startFakeOidc({ flavor: "adfs", callerClaim: "sub" })
  })
  afterEach(() => adfs.close())

  it("names the issuer in the protected resource metadata, serves no copy of the server's and logs its boot line", async () => {
    const composed = await boot({ ...adfs.env(PULSE), MCP_OAUTH_OIDC_SCOPES: "openid" })
    const resource = await fetchAt(composed, PULSE, "/.well-known/oauth-protected-resource/mcp")
    expect(await resource.json()).toEqual({
      resource: `${PULSE}/mcp`,
      authorization_servers: [adfs.issuer],
      scopes_supported: ["openid"],
    })
    const copy = await fetchAt(composed, PULSE, "/.well-known/oauth-authorization-server")
    expect(copy.status).toBe(404)
    expect(infos()).toContain(
      `[oidc-test] OAuth: tokens must carry aud ${PULSE}/mcp (RFC 8707), the scope openid and the sub claim.`,
    )
    expect(composed.boot.authenticated).toBe(true)
  })

  it("serves ADFS's access token of the access tokens' issuer, and refuses its ID token", async () => {
    const composed = await boot(adfs.env(PULSE))
    const tokens = await signIn(adfs)
    expect((await initialize(composed, PULSE, tokens.accessToken)).status).toBe(200)
    const id = await initialize(composed, PULSE, String(tokens.idToken))
    expect(id.status).toBe(401)
    expect(id.headers.get("www-authenticate")).toContain(
      "Token audience does not include the protected resource",
    )
  })

  it("refuses a token for another resource, and a token without the caller claim it names", async () => {
    const composed = await boot({ ...adfs.env(PULSE), MCP_OAUTH_OIDC_SUBJECT_CLAIM: "uid" })
    const tokens = await signIn(adfs)
    expect((await initialize(composed, PULSE, tokens.accessToken)).status).toBe(401)
    const other = await boot(adfs.env("https://other.example.test"))
    expect((await initialize(other, "https://other.example.test", tokens.accessToken)).status).toBe(
      401,
    )
  })
})

describe("the generic provider at a Keycloak whose clients register themselves", () => {
  /** A client that registered itself and turned on refresh tokens for client credentials. */
  const REGISTERED = { id: "registered", secret: "registered-secret", serviceAccountSession: true }
  let keycloak: FakeOidc
  beforeEach(async () => {
    keycloak = await startFakeOidc({
      audience: `${PULSE}/mcp`,
      clients: [FAKE_OIDC_CLIENT, REGISTERED],
    })
  })
  afterEach(() => keycloak.close())

  /** What anyone who registered a client gets: its service account's token, which names no user. */
  async function serviceAccountToken(client = FAKE_OIDC_CLIENT): Promise<string> {
    const metadata = await metadataOf(keycloak)
    const grant = { type: "client_credentials", scopes: [] } as const
    return (await requestToken(tokenEndpointOf(metadata, client), grant, platform)).accessToken
  }

  it("refuses a service account's token where MCP_OAUTH_OIDC_REQUIRED_CLAIMS names sid and auth_time, and serves a user's", async () => {
    const env = { MCP_URL: PULSE, MCP_OAUTH_OIDC_ISSUER: keycloak.issuer }
    const open = await boot(env)
    expect((await initialize(open, PULSE, await serviceAccountToken())).status).toBe(200)
    const composed = await boot({ ...env, MCP_OAUTH_OIDC_REQUIRED_CLAIMS: "sid,auth_time" })
    expect(infos()).toContain(
      `[oidc-test] OAuth: tokens must carry aud ${PULSE}/mcp (RFC 8707) and the sub, sid and auth_time claims.`,
    )
    const refused = await initialize(composed, PULSE, await serviceAccountToken())
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toContain("Token carries no sid claim")
    const user = await signIn(keycloak)
    expect((await initialize(composed, PULSE, user.accessToken)).status).toBe(200)
  })

  it("serves a service account with a session where only sid is required, and refuses it by auth_time", async () => {
    const env = { MCP_URL: PULSE, MCP_OAUTH_OIDC_ISSUER: keycloak.issuer }
    const sidOnly = await boot({ ...env, MCP_OAUTH_OIDC_REQUIRED_CLAIMS: "sid" })
    const withSession = await serviceAccountToken(REGISTERED)
    expect((await initialize(sidOnly, PULSE, withSession)).status).toBe(200)
    const composed = await boot({ ...env, MCP_OAUTH_OIDC_REQUIRED_CLAIMS: "sid,auth_time" })
    const refused = await initialize(composed, PULSE, withSession)
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toContain("Token carries no auth_time claim")
  })

  it("refuses to boot with a variable under its prefix that it does not read, naming the one meant", async () => {
    await expect(
      boot({
        MCP_URL: PULSE,
        MCP_OAUTH_OIDC_ISSUER: keycloak.issuer,
        MCP_OAUTH_OIDC_REQUIRED_CLAIM: "sid",
      }),
    ).rejects.toThrow(
      "MCP_OAUTH_OIDC_REQUIRED_CLAIM is no variable the server reads (did you mean MCP_OAUTH_OIDC_REQUIRED_CLAIMS?)",
    )
  })
})

describe("the generic provider's gate over its discovery", () => {
  const ORIGIN = "http://localhost"
  let idp: Idp
  beforeEach(async () => {
    idp = await startIdp()
  })
  afterEach(() => idp.close())

  const discoveryPath = () => `${new URL(idp.issuer).pathname}/.well-known/openid-configuration`
  const token = (exp = now() + 3600) =>
    sign({ iss: idp.issuer, aud: `${ORIGIN}/mcp`, sub: "u-1", exp })

  it("answers 503 before its discovery answers, never 500, and says why once", async () => {
    const composed = await boot({ MCP_URL: ORIGIN, MCP_OAUTH_OIDC_ISSUER: idp.issuer })
    const refused = await initialize(composed, ORIGIN, token())
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({
      error: "temporarily_unavailable",
      error_description: `The signing keys of ${idp.issuer} are not known yet, so no token can be verified. Retry shortly.`,
    })
    expect(warnings()).toContain(
      `[oidc-test] OAuth: the discovery of ${idp.issuer} failed: the document cannot be used (no-issuer). Until it answers, /mcp answers 503 (temporarily_unavailable).`,
    )
  })

  it("keeps the key set it found when the discovery fails an hour later, and says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    idp.sets[discoveryPath()] = { issuer: idp.issuer, jwks_uri: `${idp.url}/keys` }
    const composed = await boot({ MCP_URL: ORIGIN, MCP_OAUTH_OIDC_ISSUER: idp.issuer })
    const lasting = token(now() + 3 * 3600)
    expect((await initialize(composed, ORIGIN, lasting)).status).toBe(200)
    delete idp.sets[discoveryPath()]
    vi.setSystemTime(Date.now() + 3_600_000)
    expect((await initialize(composed, ORIGIN, lasting)).status).toBe(200)
    expect(warnings()).toContain(
      `[oidc-test] OAuth: the discovery of ${idp.issuer} failed: the document cannot be used (no-issuer). It keeps the key set it found last and reads again in an hour.`,
    )
  })
})
