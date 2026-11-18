import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { oauthEntraProvider, readEntraSettings } from "./oauth-entra.js"
import {
  JWK_RSA,
  JWK_RSA2,
  now,
  resetIdp,
  rsa2,
  sign,
  startIdp,
  type Idp,
} from "./oauth-jwt.test-support.js"
import { describeOAuthTokens } from "./oauth-providers.js"
import { isAudienceRefusal } from "./oauth-shared.js"

/**
 * Microsoft Entra ID for one tenant: what its variables accept and refuse, what it serves, and its
 * gate over the tenant's two key sets at a loopback identity provider that plays the cloud.
 */

const TENANT = "4f1b6d0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b"
const OTHER_TENANT = "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4"
const API = "7d2e9c41-6b3f-4a8e-9f10-2b3c4d5e6f70"
const GRAPH = "00000003-0000-0000-c000-000000000000"
/** VS Code's client id, which an operator may paste in upper case, and a web client's. */
const VSCODE = "aebc6443-996d-45c2-90f0-388ff96faa56"
const WEB = "0f6e5d4c-3b2a-4190-8877-665544332211"
const RESOURCE = new URL("https://pulse.example.test/mcp")
const VERSION_HINT =
  "Token is an Entra ID v1 access token (ver 1.0, issuer https://sts.windows.net/<tenant>/): set requestedAccessTokenVersion to 2 in the API registration's manifest"
const OTHER_API = "Token audience does not include the protected resource"
const MALFORMED = "Token audience claim must be a string or string array"

/** The refusal of `run`, its message. */
function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a refusal")
}

const read = (values: Record<string, string> = {}, tenant = TENANT, api = API) =>
  readEntraSettings(tenant, api, values)

describe("readEntraSettings: the API", () => {
  it("defaults the scope, the App ID URI, the cloud and every client", () => {
    expect(read()).toEqual({
      tenant: TENANT,
      apiClientId: API,
      scope: "user_impersonation",
      appIdUris: [`api://${API}`],
      authority: "https://login.microsoftonline.com",
    })
  })

  it("takes the API's client id in lower case, and refuses one that is no GUID", () => {
    expect(read({}, TENANT, API.toUpperCase()).apiClientId).toBe(API)
    for (const api of [`api://${API}`, "pulse-api", `${API}0`]) {
      expect(
        refusal(() => read({}, TENANT, api)),
        api,
      ).toBe(
        "MCP_OAUTH_ENTRA_API_CLIENT_ID must be the API registration's Application (client) ID, a GUID: the aud of its v2 access tokens.",
      )
    }
  })

  it.each(["access_as_user", "Pulse.Read", "mcp:tools", "a"])("takes the scope %s", (scope) => {
    expect(read({ scope }).scope).toBe(scope)
  })

  it.each([`api://${API}/user_impersonation`, "a b", ".default", "", 'a"b', "a\\b", "ä"])(
    "refuses the scope %j, which is no short scope name",
    (scope) => {
      expect(refusal(() => read({ scope }))).toBe(
        "MCP_OAUTH_ENTRA_SCOPE must name one scope the API exposes, as tokens carry it in scp (user_impersonation), without its App ID URI, which MCP_OAUTH_ENTRA_APP_ID_URI names.",
      )
    },
  )

  it.each([
    "api://pulse",
    `api://${TENANT}/${API}`,
    "https://pulse.example.test/mcp",
    "https://contoso.onmicrosoft.com/pulse",
  ])("takes the App ID URI %s", (appIdUri) => {
    expect(read({ appIdUri }).appIdUris).toEqual([appIdUri])
  })

  it("takes several App ID URIs separated by commas or spaces, each once, in their order", () => {
    expect(
      read({ appIdUri: `api://${API}, https://pulse.example.test/mcp api://${API}` }).appIdUris,
    ).toEqual([`api://${API}`, "https://pulse.example.test/mcp"])
    expect(refusal(() => read({ appIdUri: " , " }))).toBe(
      "MCP_OAUTH_ENTRA_APP_ID_URI holds no value.",
    )
  })

  it.each([
    "pulse",
    "http://pulse.example.test/mcp",
    "urn:pulse",
    "ftp://pulse",
    "api://pulse/",
    "https://pulse.example.test/",
    "api://pulse?x=1",
    "api://pulse#x",
    "xapi://pulse",
    "httpsx://pulse.example.test/mcp",
  ])("refuses the App ID URI %s, also beside a good one", (appIdUri) => {
    const message =
      "MCP_OAUTH_ENTRA_APP_ID_URI must name App ID URIs of the API registration (api://... or https://...) without a query, a fragment or a trailing slash: the API's scopes are named <App ID URI>/<scope> by the first."
    expect(refusal(() => read({ appIdUri }))).toBe(message)
    expect(refusal(() => read({ appIdUri: `api://${API},${appIdUri}` }))).toBe(message)
  })
})

describe("readEntraSettings: the cloud and the clients", () => {
  const clients = (raw: string, web?: string) =>
    readEntraSettings(TENANT, API, { clientIds: raw }, web).clients

  it.each([
    ["https://login.microsoftonline.com/", "https://login.microsoftonline.com"],
    ["https://login.microsoftonline.us", "https://login.microsoftonline.us"],
    ["https://login.partner.microsoftonline.cn", "https://login.partner.microsoftonline.cn"],
    ["http://127.0.0.1:8480", "http://127.0.0.1:8480"],
    ["http://localhost:8480/", "http://localhost:8480"],
    ["https://localhost", "https://localhost"],
  ])("takes the authority %s as %s", (authority, origin) => {
    expect(read({ authority }).authority).toBe(origin)
  })

  it.each([
    `https://login.microsoftonline.com/${TENANT}`,
    "http://login.microsoftonline.com",
    "https://login.microsoftonline.com:8443",
    "https://login.microsoftonline.de",
    "https://idp.example.test",
    "login.microsoftonline.com",
    "ftp://localhost",
    "xhttp://localhost",
  ])("refuses the authority %s", (authority) => {
    expect(refusal(() => read({ authority }))).toBe(
      "MCP_OAUTH_ENTRA_AUTHORITY must be the origin of an Entra ID cloud: https://login.microsoftonline.com, https://login.microsoftonline.us, https://login.partner.microsoftonline.cn (http only on localhost, for tests).",
    )
  })

  it("reads the clients separated by commas or spaces, and adds the web sign-in's once", () => {
    expect(clients("claude, vscode")).toEqual(["claude", "vscode"])
    expect(clients("claude", "pulse-web")).toEqual(["claude", "pulse-web"])
    expect(clients("pulse-web claude", "pulse-web")).toEqual(["pulse-web", "claude"])
    expect(readEntraSettings(TENANT, API, {}, "pulse-web")).not.toHaveProperty("clients")
    expect(refusal(() => clients(" , "))).toBe("MCP_OAUTH_ENTRA_CLIENT_IDS holds no value.")
  })

  it("keeps a client's GUID in lower case as azp names it, any other id as it is", () => {
    expect(clients(`${VSCODE.toUpperCase()} Claude`, WEB.toUpperCase())).toEqual([
      VSCODE,
      "Claude",
      WEB,
    ])
    expect(clients(`${VSCODE}, ${VSCODE.toUpperCase()}`, WEB)).toEqual([VSCODE, WEB])
  })
})

describe("oauthEntraProvider: what it serves and says", () => {
  const AUTHORITY = "https://login.microsoftonline.com"
  const SCOPE = `api://${API}/user_impersonation`

  it("names the oauth21 authority, the full scope, oid else sub and the web client's options", () => {
    const provider = oauthEntraProvider(read())
    expect(provider.oauthMetadata).toEqual({ issuer: `${AUTHORITY}/${TENANT}/oauth21/2026-08` })
    expect(provider.requiredScopes).toEqual([SCOPE])
    expect(provider.callerClaims).toEqual(["oid", "sub"])
    expect(provider.web).toEqual({
      scopes: ["openid", "profile", "offline_access"],
      discoveryIssuer: `${AUTHORITY}/${TENANT}/v2.0`,
      resource: false,
      grantScopes: true,
    })
    expect(provider.discovery).toBeUndefined()
    expect(provider.scopesSupported).toBeUndefined()
  })

  it("says in the boot line what a token must carry", () => {
    expect(describeOAuthTokens(oauthEntraProvider(read()), RESOURCE)).toBe(
      `OAuth: tokens must carry iss ${AUTHORITY}/${TENANT}/v2.0 or ${AUTHORITY}/${TENANT}/oauth21/2026-08, aud ${API} or api://${API}, ver 2.0, the scope ${SCOPE} and an oid or sub claim.`,
    )
    const narrowed = read({
      appIdUri: `https://pulse.example.test/api ${RESOURCE.href} api://${API}`,
      scope: "mcp",
      clientIds: "a b",
    })
    expect(describeOAuthTokens(oauthEntraProvider(narrowed), RESOURCE)).toContain(
      `aud ${API}, https://pulse.example.test/api, ${RESOURCE.href} (RFC 8707) or api://${API}, ver 2.0, the scope https://pulse.example.test/api/mcp, a client id a or b and an oid or sub claim.`,
    )
  })

  it("maps the caller by oid, else sub, and the app roles as its permissions", () => {
    const provider = oauthEntraProvider(read())
    const info = (payload: Record<string, unknown>) => ({
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { payload },
    })
    const both = provider.mapAuthInfo(info({ oid: "o-1", sub: "s-1", roles: ["Engine.Admin"] }))
    expect(both).toMatchObject({ user: { id: "o-1" }, permissions: ["Engine.Admin"] })
    const sub = provider.mapAuthInfo(info({ sub: "s-1", permissions: ["x"] }))
    expect(sub).toMatchObject({ user: { id: "s-1" }, permissions: [] })
    expect(() => provider.mapAuthInfo(info({ upn: "alice@example.test" }))).toThrow(
      "Missing Entra ID subject",
    )
  })
})

describe("oauthEntraProvider: the gate over the tenant's two key sets", () => {
  let idp: Idp
  beforeAll(async () => {
    idp = await startIdp()
  })
  afterAll(() => idp.close())

  const v2 = () => `${idp.url}/${TENANT}/v2.0`
  const oauth21 = () => `${idp.url}/${TENANT}/oauth21/2026-08`
  const V2_KEYS = `/${TENANT}/discovery/v2.0/keys`
  const OAUTH21_KEYS = `/${TENANT}/oauth21/2026-08/keys`

  /** The key sets as Entra ID's: v2.0's tagged by the template, oauth21's with a key of its own. */
  beforeEach(() => {
    idp.sets[V2_KEYS] = { keys: [{ ...JWK_RSA, issuer: `${idp.url}/{tenantid}/v2.0` }] }
    idp.sets[OAUTH21_KEYS] = {
      keys: [
        { ...JWK_RSA, issuer: oauth21() },
        { ...JWK_RSA2, issuer: oauth21() },
      ],
    }
  })
  afterEach(() => {
    resetIdp(idp)
    vi.restoreAllMocks()
  })

  const gate = (values: Record<string, string> = {}, debug = false) =>
    oauthEntraProvider(read({ authority: idp.url, ...values }), { debug }).createTokenVerifier(
      RESOURCE,
    )

  /** A v2 access token of the v2.0 authority for the API, as a web sign-in gets it. */
  const token = (claims: Record<string, unknown> = {}, options = {}) =>
    sign(
      {
        iss: v2(),
        aud: API,
        ver: "2.0",
        scp: "user_impersonation",
        azp: "pulse-web",
        oid: "o-1",
        sub: "s-1",
        tid: TENANT,
        exp: now() + 3600,
        ...claims,
      },
      options,
    )

  const OAUTH21_KEY = { key: rsa2.privateKey, kid: "k2" }

  it("takes the v2.0 authority's token, its scp read under the App ID URI", async () => {
    const verified = await gate().verifyAccessToken(token({ scp: "user_impersonation other" }))
    expect(verified).toMatchObject({
      clientId: "pulse-web",
      scopes: [`api://${API}/user_impersonation`, `api://${API}/other`],
      resource: RESOURCE,
    })
    expect(idp.paths).toEqual([V2_KEYS])
  })

  it("takes the oauth21 authority's token signed by the key only its own set holds", async () => {
    const verified = await gate().verifyAccessToken(token({ iss: oauth21() }, OAUTH21_KEY))
    expect(verified).toMatchObject({ resource: RESOURCE })
    expect(idp.paths).toEqual([OAUTH21_KEYS])
    await expect(gate().verifyAccessToken(token({}, OAUTH21_KEY))).rejects.toThrow(
      "JWT verification failed",
    )
  })

  it.each([
    ["the oauth21 authority", () => oauth21()],
    ["another tenant", () => `${idp.url}/${OTHER_TENANT}/v2.0`],
  ])("refuses a v2.0 token signed by a key its set holds tagged for %s", async (_case, tag) => {
    idp.sets[V2_KEYS] = { keys: [{ ...JWK_RSA2, issuer: tag() }] }
    await expect(gate().verifyAccessToken(token({}, OAUTH21_KEY))).rejects.toThrow(
      "JWT verification failed",
    )
  })

  it("refuses an oauth21 token signed by a key its set holds tagged for the v2.0 authority", async () => {
    idp.sets[OAUTH21_KEYS] = { keys: [{ ...JWK_RSA2, issuer: v2() }] }
    await expect(gate().verifyAccessToken(token({ iss: oauth21() }, OAUTH21_KEY))).rejects.toThrow(
      "JWT verification failed",
    )
  })

  it("refuses a token of another tenant before any key set loads", async () => {
    const other = token({ iss: `${idp.url}/${OTHER_TENANT}/v2.0`, tid: OTHER_TENANT })
    await expect(gate().verifyAccessToken(other)).rejects.toThrow("JWT verification failed")
    expect(idp.paths).toEqual([])
  })

  const NAMED = { appIdUri: "https://pulse.example.test/api" }

  /** A v1 access token as Entra ID issues one, of sts.windows.net and with `appid`. */
  const v1Token = (claims: Record<string, unknown>) =>
    token({ iss: `https://sts.windows.net/${TENANT}/`, ver: "1.0", azp: undefined, ...claims })

  it.each<[string, unknown, string, Record<string, string>?]>([
    ["the API's App ID URI", `api://${API}`, VERSION_HINT],
    ["the API's client id", API, VERSION_HINT],
    ["the API among others", [GRAPH, `api://${API}`], VERSION_HINT],
    ["Microsoft Graph's id", GRAPH, OTHER_API],
    ["Microsoft Graph's URL", "https://graph.microsoft.com", OTHER_API],
    ["Microsoft Graph twice", [GRAPH, "https://graph.microsoft.com"], OTHER_API],
    ["the resource it does not name", RESOURCE.href, OTHER_API],
    ["a scope", `api://${API}/user_impersonation`, OTHER_API],
    ["the API and another word in one string", `api://${API} x`, OTHER_API],
    ["no audience", undefined, MALFORMED],
    ["a number", 7, MALFORMED],
    ["an empty list", [], MALFORMED],
    ["the API beside a number", [7, `api://${API}`], MALFORMED],
    ["an App ID URI the operator names", "https://pulse.example.test/api", VERSION_HINT, NAMED],
  ])("refuses a v1 token whose aud is %s before a key set loads", async (_c, aud, why, values) => {
    const v1 = v1Token({ aud, appid: VSCODE, scp: "openid profile User.Read" })
    const refused = (await gate(values)
      .verifyAccessToken(v1)
      .catch((error: unknown) => error)) as Error
    expect(refused.message).toBe(why)
    expect(isAudienceRefusal(refused)).toBe(why !== VERSION_HINT)
    expect(idp.paths).toEqual([])
  })

  it("refuses a token of its issuer whose ver is not 2.0, and one that is no JWT", async () => {
    for (const ver of [undefined, "2", 2]) {
      await expect(gate().verifyAccessToken(token({ ver })), String(ver)).rejects.toThrow(
        "Token is no Entra ID v2.0 access token (its ver is not 2.0)",
      )
    }
    await expect(gate().verifyAccessToken("not-a-jwt")).rejects.toThrow("JWT verification failed")
  })

  it("takes a token without tid, and refuses one whose tid names another tenant", async () => {
    expect(await gate().verifyAccessToken(token({ tid: undefined }))).toMatchObject({
      resource: RESOURCE,
    })
    await expect(gate().verifyAccessToken(token({ tid: OTHER_TENANT }))).rejects.toThrow(
      "Token was issued in another tenant (its tid)",
    )
  })

  it("refuses an app-only token and an ID token for the API, neither of which carries scp", async () => {
    const appOnly = token({ scp: undefined, roles: ["Engine.Read"], idtyp: "app", azp: API })
    const idToken = token({ scp: undefined, aud: API, nonce: "n" })
    for (const refused of [appOnly, idToken, token({ scp: "" }), token({ scp: [] })]) {
      await expect(gate().verifyAccessToken(refused)).rejects.toThrow(
        "Token carries no scp: an app-only token or an ID token names no signed-in user",
      )
    }
    await expect(gate().verifyAccessToken(token({ at_hash: "h", aud: API }))).rejects.toThrow(
      "Token is an ID, logout or refresh token, not an access token (its at_hash claim)",
    )
  })

  it("takes the API's client id or its App ID URI as aud, never Graph's", async () => {
    for (const aud of [API, `api://${API}`]) {
      expect(await gate().verifyAccessToken(token({ aud })), aud).toMatchObject({
        resource: RESOURCE,
      })
    }
    for (const aud of [GRAPH, "api://other", "https://graph.microsoft.com"]) {
      await expect(gate().verifyAccessToken(token({ aud })), aud).rejects.toThrow(OTHER_API)
    }
  })

  it("takes the resource as aud only where the operator names it an App ID URI of the API", async () => {
    // Another app of the tenant may own <MCP_URL>/mcp as its App ID URI and get tokens for it.
    const another = token({ aud: RESOURCE.href, azp: "another-app" })
    await expect(gate().verifyAccessToken(another)).rejects.toThrow(OTHER_API)
    await expect(
      gate({ appIdUri: "https://pulse.example.test/api" }).verifyAccessToken(another),
    ).rejects.toThrow(OTHER_API)
    await expect(
      gate().verifyAccessToken(token({ aud: "api://other", resource: RESOURCE.href })),
    ).rejects.toThrow(OTHER_API)
    const named = gate({ appIdUri: `api://${API},${RESOURCE.href}` })
    expect(await named.verifyAccessToken(another)).toMatchObject({ resource: RESOURCE })
    expect((await named.verifyAccessToken(token())).scopes).toEqual([
      `api://${API}/user_impersonation`,
    ])
  })

  it("reads scp under its own App ID URI, and takes only the clients it names", async () => {
    const own = gate({ appIdUri: "https://pulse.example.test/api", clientIds: "claude" })
    const verified = await own.verifyAccessToken(
      token({ aud: "https://pulse.example.test/api", azp: "claude" }),
    )
    expect(verified.scopes).toEqual(["https://pulse.example.test/api/user_impersonation"])
    await expect(own.verifyAccessToken(token())).rejects.toThrow(
      "Token was issued to a client this server does not accept",
    )
  })

  it("takes the token of a client the allowlist names in upper case", async () => {
    const allowed = gate({ clientIds: VSCODE.toUpperCase() })
    await expect(allowed.verifyAccessToken(token({ azp: VSCODE }))).resolves.toMatchObject({
      clientId: VSCODE,
    })
  })

  it("names no caller without oid and sub", async () => {
    await expect(
      gate().verifyAccessToken(token({ oid: undefined, sub: undefined })),
    ).rejects.toThrow("JWT verification failed")
  })

  it("logs why Entra ID's rules refused a token with the debug switch, and only then", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const lines = () => errors.mock.calls.map(([line]) => String(line))
    await gate()
      .verifyAccessToken(token({ tid: OTHER_TENANT }))
      .catch(() => {})
    expect(errors).not.toHaveBeenCalled()
    await gate({}, true)
      .verifyAccessToken(token({ tid: OTHER_TENANT }))
      .catch(() => {})
    await gate({}, true)
      .verifyAccessToken(token({ ver: "1.0" }))
      .catch(() => {})
    await gate({}, true)
      .verifyAccessToken(token({ ver: "1.0", aud: GRAPH }))
      .catch(() => {})
    expect(lines()).toEqual([
      "[oauth-debug] Entra ID refused the token: Token was issued in another tenant (its tid)",
      `[oauth-debug] Entra ID refused the token: ${VERSION_HINT}`,
      `[oauth-debug] Entra ID refused the token: ${OTHER_API}`,
    ])
    await gate({}, true)
      .verifyAccessToken(token({ sub: undefined, oid: undefined }))
      .catch(() => {})
    expect(lines()).toContain("[oauth-debug] claim=oid or sub reason=missing")
  })
})
