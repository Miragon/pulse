import { requestToken } from "@miragon/pulse-http/oauth"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { oauthFromEnv } from "../oauth-env.js"
import { createJwtVerifier } from "../oauth-jwt.js"
import { oauthOidcProvider } from "../oauth-oidc.js"
import {
  mapSubject,
  oauthCustomProvider,
  type OAuthProvider,
  type OAuthWebClient,
} from "../oauth-providers.js"
import {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  startFakeOidc,
  type FakeEntraTenant,
  type FakeOidc,
  type FakeOidcOptions,
} from "../testing/oidc/index.js"
import { FIXTURE_BUILD } from "./build.test-support.js"
import {
  bootWeb,
  Browser,
  ORIGIN,
  SESSION_KEYS,
  sessionOf,
  signIn,
  startSignIn,
} from "./sign-in.test-support.js"

/**
 * The web sign-in at the fake Entra ID through a provider of the test's own: the web client's
 * options send no resource and the scopes at every grant, and the sign-in discovers the tenant's
 * v2.0 authority while the protected resource metadata names its oauth21 one. The web client's
 * discovery issuer is the one a callback's `iss` must name, and the sign-in discovers it itself
 * even where the provider's gate has a discovery of its own.
 */

let fake: FakeOidc
let warned: MockInstance<(...data: unknown[]) => void>

const startEntra = async (options: FakeOidcOptions = {}) => {
  fake = await startFakeOidc({ flavor: "entra", ...options })
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  warned = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const [ALICE] = FAKE_OIDC_USERS

const tenantOf = (): FakeEntraTenant => {
  if (fake.entra === undefined) throw new Error("no Entra ID tenant")
  return fake.entra
}

/** The API's scope as a client asks for it, which the gate requires. */
const apiScope = (): string => `${tenantOf().appIdUris[0]}/${tenantOf().scope}`

/** The web client as an Entra ID provider names it: v2.0, no resource, scopes at every grant. */
const ENTRA_WEB = (): OAuthWebClient => ({
  scopes: ["openid", "profile", "offline_access"],
  discoveryIssuer: fake.issuer,
  resource: false,
  grantScopes: true,
})

/**
 * A provider of the test's own over the fake tenant: the metadata names the oauth21 authority,
 * the gate takes either authority's tokens with its own tagged keys, the API's client id as the
 * audience, the scope read from a short `scp`, `oid` else `sub` the caller.
 */
function entraProvider(web: Partial<OAuthWebClient> = {}): OAuthProvider {
  const { tenant, oauth21Issuer, apiClientId, appIdUris } = tenantOf()
  const callerClaims = ["oid", "sub"]
  const keySets = [
    {
      issuer: fake.issuer,
      jwks: new URL(`${fake.serverUrl}/${tenant}/discovery/v2.0/keys`),
      taggedKeys: true,
    },
    { issuer: oauth21Issuer, jwks: new URL(`${oauth21Issuer}/keys`), taggedKeys: true },
  ]
  return oauthCustomProvider({
    oauthMetadata: { issuer: oauth21Issuer },
    requiredScopes: [apiScope()],
    callerClaims,
    web: { ...ENTRA_WEB(), ...web },
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        keySets,
        resource,
        audiences: [apiClientId],
        callerClaims,
        scopePrefix: appIdUris[0],
      }),
    mapAuthInfo: mapSubject("Entra ID", callerClaims),
  })
}

/** A server whose web app signs in at the fake Entra ID through `provider`. */
const bootEntra = (provider: OAuthProvider = entraProvider()) =>
  bootWeb(
    {
      MCP_URL: ORIGIN,
      MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
      MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
      MCP_WEB_SESSION_KEYS: SESSION_KEYS,
      MCP_WEB_DIR: FIXTURE_BUILD,
    },
    { oauth: provider },
  )

/**
 * The provider the other way round: its metadata names the v2.0 authority, its web client signs in
 * through the oauth21 one, whose authorization response carries an `iss`.
 */
const throughOauth21 = (): OAuthProvider => ({
  ...entraProvider({ discoveryIssuer: tenantOf().oauth21Issuer }),
  oauthMetadata: { issuer: fake.issuer },
})

/** The browser on a server booted again over `provider`, its cookies kept, no discovery read yet. */
async function afterRestart(browser: Browser, provider: OAuthProvider): Promise<Browser> {
  const restarted = new Browser(await bootEntra(provider))
  for (const [name, value] of browser.cookies) restarted.cookies.set(name, value)
  return restarted
}

/** A refresh at the tenant's v2.0 token endpoint as the web client, with its scopes. */
const renewedAtTenant = (refreshToken: string) =>
  requestToken(
    {
      url: `${fake.serverUrl}/${tenantOf().tenant}/oauth2/v2.0/token`,
      clientId: FAKE_OIDC_CLIENT.id,
      clientSecret: String(FAKE_OIDC_CLIENT.secret),
      clientAuth: "basic",
    },
    { type: "refresh_token", refreshToken, scopes: [...ENTRA_WEB().scopes, apiScope()] },
    { fetch: globalThis.fetch, now: () => Date.now() },
  )

const requestsTo = (endpoint: string, grant?: string) =>
  fake.requests.filter(
    (request) =>
      request.endpoint === endpoint &&
      (grant === undefined || request.form.get("grant_type") === grant),
  )

/** The parameters of a request, each with all its values. */
const paramsOf = (params: URLSearchParams) =>
  Object.fromEntries([...new Set(params.keys())].map((name) => [name, params.getAll(name)]))

const warnings = () => warned.mock.calls.map(([line]) => String(line))

describe("the web sign-in at Entra ID", () => {
  it("discovers the v2.0 authority while the protected resource metadata names the oauth21 one", async () => {
    await startEntra()
    const app = await bootEntra()
    const metadata = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`, {
        headers: { host: "localhost" },
      }),
    )
    expect(await metadata.json()).toMatchObject({
      authorization_servers: [tenantOf().oauth21Issuer],
      scopes_supported: [apiScope()],
    })
    const browser = new Browser(app)
    const { authorization } = await startSignIn(browser, fake)
    expect(
      authorization.startsWith(`${fake.serverUrl}/${tenantOf().tenant}/oauth2/v2.0/authorize?`),
    ).toBe(true)
    const callback = await browser.fetch(await fake.signIn(authorization))
    expect(callback.headers.get("location")).toBe("/app")
    expect(requestsTo("discovery").map(({ path }) => path)).toEqual([
      `/${tenantOf().tenant}/v2.0/.well-known/openid-configuration`,
    ])
    expect(await sessionOf(browser)).toMatchObject({ status: 200, body: { name: ALICE.name } })
  })

  it("asks the scopes and no resource at the authorization request and the code exchange", async () => {
    await startEntra()
    const browser = new Browser(await bootEntra())
    const { authorization } = await startSignIn(browser, fake)
    const scope = `openid profile offline_access ${apiScope()}`
    expect(paramsOf(new URL(authorization).searchParams)).toEqual({
      response_type: ["code"],
      client_id: [FAKE_OIDC_CLIENT.id],
      redirect_uri: [`${ORIGIN}/app/auth/callback`],
      scope: [scope],
      state: [expect.any(String)],
      code_challenge: [expect.any(String)],
      code_challenge_method: ["S256"],
    })
    await browser.fetch(await fake.signIn(authorization))
    const [exchange] = requestsTo("token", "authorization_code")
    expect(paramsOf(exchange.form)).toEqual({
      grant_type: ["authorization_code"],
      code: [expect.any(String)],
      redirect_uri: [`${ORIGIN}/app/auth/callback`],
      code_verifier: [expect.any(String)],
      scope: [scope],
    })
  })

  it("renews with the scopes and no resource, and takes the rotated refresh token", async () => {
    await startEntra({ accessTokenSeconds: 5 })
    const browser = new Browser(await bootEntra())
    await signIn(browser, fake)
    expect((await sessionOf(browser)).status).toBe(200)
    expect((await sessionOf(browser)).status).toBe(200)
    const renewals = requestsTo("token", "refresh_token")
    expect(renewals).toHaveLength(2)
    const scope = `openid profile offline_access ${apiScope()}`
    for (const renewal of renewals) {
      expect(paramsOf(renewal.form)).toEqual({
        grant_type: ["refresh_token"],
        refresh_token: [expect.any(String)],
        scope: [scope],
      })
    }
    const [first, second] = renewals.map((renewal) => renewal.form.get("refresh_token"))
    expect(second).not.toBe(first)
    expect(second).toBe(fake.issued.refresh[1])
  })

  it("fails a sign-in that names the resource, which Entra ID refuses as no App ID URI", async () => {
    await startEntra()
    const browser = new Browser(await bootEntra(entraProvider({ resource: undefined })))
    const callback = await signIn(browser, fake)
    expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
    expect(warnings()).toContain(
      "[web-test] Web sign-in failed (failed): the identity provider answered invalid_target.",
    )
    expect(requestsTo("token")).toEqual([])
  })

  it("fails a sign-in whose code exchange names no scope, which Entra ID refuses", async () => {
    await startEntra()
    const browser = new Browser(await bootEntra(entraProvider({ grantScopes: undefined })))
    const callback = await signIn(browser, fake)
    expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
    const [exchange] = requestsTo("token", "authorization_code")
    expect(exchange.form.has("scope")).toBe(false)
    expect(warnings().join("\n")).toMatch(
      /Web sign-in failed \(failed\): the token endpoint gave no token \(.*invalid_request/,
    )
  })

  it("signs out at the v2.0 authority's end of the session, which leaves the refresh token alive", async () => {
    await startEntra()
    const browser = new Browser(await bootEntra())
    await signIn(browser, fake)
    const { body } = await sessionOf(browser)
    const signedOut = await browser.logout(String(body.csrf))
    const next = new URL(String(((await signedOut.json()) as { location: string }).location))
    expect(`${next.origin}${next.pathname}`).toBe(
      `${fake.serverUrl}/${tenantOf().tenant}/oauth2/v2.0/logout`,
    )
    expect(fake.revoked).toEqual([])
    expect(requestsTo("unknown")).toEqual([])
    // The browser follows it with the tenant's session cookie, which names the session to end.
    const [refreshToken] = fake.issued.refresh
    const sid = String(fake.sessionOf(refreshToken))
    const headers = { cookie: `KEYCLOAK_SESSION=${sid}` }
    const ended = await fetch(next, { headers, redirect: "manual" })
    expect(ended.headers.get("location")).toBe(`${ORIGIN}/app/signed-out`)
    expect(fake.endedSessions).toEqual([expect.objectContaining({ sid })])
    expect((await sessionOf(browser)).status).toBe(401)
    // Entra ID's single sign-out: the session's refresh token renews on at the tenant.
    const renewed = await renewedAtTenant(refreshToken)
    expect(renewed.accessToken).toEqual(expect.any(String))
  })
})

describe("the web client's discovery issuer", () => {
  it("is the issuer the sign-in goes through and the callback's iss must name", async () => {
    await startEntra()
    const { oauth21Issuer } = tenantOf()
    const browser = new Browser(await bootEntra(throughOauth21()))
    const { authorization } = await startSignIn(browser, fake)
    expect(authorization.startsWith(`${oauth21Issuer}/authorize?`)).toBe(true)
    const back = new URL(await fake.signIn(authorization))
    expect(back.searchParams.get("iss")).toBe(oauth21Issuer)
    expect((await browser.fetch(back.href)).headers.get("location")).toBe("/app")
    expect(await sessionOf(browser)).toMatchObject({ status: 200, body: { name: ALICE.name } })
  })

  it("refuses a callback whose iss names the metadata's issuer instead, before even the discovery", async () => {
    await startEntra()
    const browser = new Browser(await bootEntra(throughOauth21()))
    const { authorization } = await startSignIn(browser, fake)
    const back = new URL(await fake.signIn(authorization))
    back.searchParams.set("iss", fake.issuer)
    const restarted = await afterRestart(browser, throughOauth21())
    const before = fake.requests.length
    const callback = await restarted.fetch(back.href)
    expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
    expect(fake.requests.slice(before)).toEqual([])
    expect(warnings().at(-1)).toContain("iss does not name the identity provider")
  })

  it("is discovered by the sign-in itself where the provider's gate has a discovery of its own", async () => {
    await startEntra()
    const { tenant, oauth21Issuer, apiClientId } = tenantOf()
    const settings = {
      issuer: oauth21Issuer,
      audiences: [apiClientId],
      scopes: [],
      subjectClaim: "sub",
    }
    const generic = oauthOidcProvider(settings, { log: () => {} })
    expect(generic.discovery).toBeDefined()
    const browser = new Browser(await bootEntra({ ...generic, web: ENTRA_WEB() }))
    const { authorization } = await startSignIn(browser, fake)
    expect(authorization.startsWith(`${fake.serverUrl}/${tenant}/oauth2/v2.0/authorize?`)).toBe(
      true,
    )
    expect(requestsTo("discovery").map(({ path }) => path)).toContain(
      `/${tenant}/v2.0/.well-known/openid-configuration`,
    )
  })
})

describe("the boot's Entra ID provider", () => {
  /** A server whose provider comes from the fake tenant's variables, as a deployment's would. */
  async function bootFromEnv() {
    const provider = oauthFromEnv(fake.env(ORIGIN), "web-test")
    if (provider === undefined) throw new Error("the fake tenant's variables name no provider")
    return bootEntra(provider)
  }

  it("signs in through the tenant's v2.0 authority with the scope its gate requires", async () => {
    await startEntra()
    const browser = new Browser(await bootFromEnv())
    const callback = await signIn(browser, fake)
    expect(callback.headers.get("location")).toBe("/app")
    expect(await sessionOf(browser)).toMatchObject({ status: 200, body: { name: ALICE.name } })
    const [exchange] = requestsTo("token", "authorization_code")
    expect(exchange.form.get("scope")).toBe(`openid profile offline_access ${apiScope()}`)
    expect(exchange.form.has("resource")).toBe(false)
  })

  it.each([
    [{ groups: true }, "a groups claim"],
    [{ groups: true, directoryRoles: true }, "a groups and a wids claim"],
  ])(
    "fails a sign-in whose id claims (%o) overflow the session's cookies, naming the size alone",
    async (claims, carried) => {
      await startEntra(claims)
      const browser = new Browser(await bootFromEnv())
      const callback = await signIn(browser, fake)
      expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
      const [accessToken] = fake.issued.access
      const line = String(warnings().at(-1))
      expect(line).toMatch(
        new RegExp(
          `the session needs \\d+ bytes, more than its cookies hold \\(its access token holds ${accessToken.length} bytes and carries ${carried}\\)\\.$`,
        ),
      )
      expect(line).not.toMatch(/[\da-f]{8}-[\da-f]{4}-/)
    },
  )
})
