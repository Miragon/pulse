import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposedServer } from "./composed-server.js"
import { moduleOf } from "./composed-server.test-support.js"
import { now, sign, startIdp, type Idp } from "./oauth-jwt.test-support.js"
import { startFakeOidc, type FakeOidc } from "./testing/oidc/index.js"
import { signIn } from "./testing/oidc/fake-oidc.test-support.js"

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
