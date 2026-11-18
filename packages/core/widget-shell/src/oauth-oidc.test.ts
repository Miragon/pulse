import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { OAuthError } from "@modelcontextprotocol/server"
import { DISCOVERY_HOLD_MS } from "./oauth-discovery.js"
import {
  JWK_EC,
  JWK_RSA,
  JWK_RSA2,
  ec,
  now,
  resetIdp,
  rsa2,
  sign,
  startIdp,
  type Idp,
} from "./oauth-jwt.test-support.js"
import { oauthOidcProvider, readOidcSettings } from "./oauth-oidc.js"
import { describeOAuthTokens } from "./oauth-providers.js"

/**
 * The generic OpenID Connect provider: what its variables accept and refuse, and its gate over
 * what the provider's discovery names (a loopback IdP that serves the document and the key sets).
 */

const ISSUER = "https://idp.example.test/oauth2/default"
const RESOURCE = new URL("http://localhost/mcp")

/** The refusal of `run`, its message. */
function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a refusal")
}

const ALGORITHMS =
  "RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512, EdDSA, Ed25519, ML-DSA-44, ML-DSA-65, ML-DSA-87"

describe("readOidcSettings: the issuer", () => {
  it.each([
    "https://idp.example.test/oauth2/default",
    "https://authentik.example.test/application/o/pulse/",
    "https://fs.example.test/adfs",
    "http://localhost:8480/realms/pulse",
    "http://127.0.0.1:9000/adfs",
  ])("takes %s exactly as it is", (issuer) => {
    expect(readOidcSettings(issuer, {}).issuer).toBe(issuer)
  })

  it.each([
    ["no URL", "idp.example.test"],
    ["plain http off the machine itself", "http://idp.example.test/adfs"],
    ["credentials", "https://user:pass@idp.example.test"],
    ["a query", "https://idp.example.test/?tenant=a"],
    ["an empty query", "https://idp.example.test/adfs?"],
    ["a fragment", "https://idp.example.test/#a"],
    ["an empty fragment", "https://idp.example.test/adfs#"],
    ["another scheme", "ftp://localhost/adfs"],
  ])("refuses %s, without quoting it", (_case, issuer) => {
    const message = refusal(() => readOidcSettings(issuer, {}))
    expect(message).toBe(
      "MCP_OAUTH_OIDC_ISSUER must be an absolute https URL (http only on localhost) without credentials, query or fragment, exactly as the provider's discovery names its issuer.",
    )
  })
})

describe("readOidcSettings: the other variables", () => {
  it("takes the resource alone, no scope, sub, every algorithm and every client by default", () => {
    expect(readOidcSettings(ISSUER, {})).toEqual({
      issuer: ISSUER,
      audiences: [],
      scopes: [],
      subjectClaim: "sub",
    })
  })

  it("reads each list separated by commas or spaces", () => {
    const settings = readOidcSettings(ISSUER, {
      audience: "https://pulse.example.test/mcp, https://api.example.test",
      scopes: "pulse.read  pulse.write,openid",
      subjectClaim: "uid",
      algorithms: "RS256,ES256 EdDSA",
      clientIds: "claude ,vscode",
    })
    expect(settings).toEqual({
      issuer: ISSUER,
      audiences: ["https://pulse.example.test/mcp", "https://api.example.test"],
      scopes: ["pulse.read", "pulse.write", "openid"],
      subjectClaim: "uid",
      algorithms: ["RS256", "ES256", "EdDSA"],
      clients: ["claude", "vscode"],
    })
  })

  it.each(["audience", "scopes", "algorithms", "clientIds"] as const)(
    "refuses a %s that holds only separators",
    (key) => {
      const name = {
        audience: "MCP_OAUTH_OIDC_AUDIENCE",
        scopes: "MCP_OAUTH_OIDC_SCOPES",
        algorithms: "MCP_OAUTH_OIDC_ALGORITHMS",
        clientIds: "MCP_OAUTH_OIDC_CLIENT_IDS",
      }[key]
      expect(refusal(() => readOidcSettings(ISSUER, { [key]: " , " }))).toBe(
        `${name} holds no value.`,
      )
    },
  )

  it("adds the web sign-in's client to an allowlist once, and makes none of it", () => {
    expect(readOidcSettings(ISSUER, { clientIds: "claude" }, "pulse-web").clients).toEqual([
      "claude",
      "pulse-web",
    ])
    expect(
      readOidcSettings(ISSUER, { clientIds: "pulse-web,claude" }, "pulse-web").clients,
    ).toEqual(["pulse-web", "claude"])
    expect(readOidcSettings(ISSUER, {}, "pulse-web")).not.toHaveProperty("clients")
  })
})

describe("readOidcSettings: an audience no client's id can be, or a scope", () => {
  it.each(["https://pulse.example.test/mcp", "http://localhost:8400/mcp", "http://127.0.0.1/mcp"])(
    "takes the URL audience %s without a scope",
    (audience) => {
      expect(readOidcSettings(ISSUER, { audience }).audiences).toEqual([audience])
    },
  )

  it.each([
    ["a client id", "0oa1b2c3"],
    ["plain http off the machine itself", "http://pulse.example.test/mcp"],
    ["a URN", "urn:pulse:mcp"],
    ["an App ID URI", "api://pulse"],
    ["another scheme on the machine itself", "ftp://localhost/mcp"],
  ])("refuses %s without a scope, naming the first such audience", (_case, audience) => {
    expect(
      refusal(() =>
        readOidcSettings(ISSUER, { audience: `https://pulse.example.test/mcp,${audience},x` }),
      ),
    ).toBe(
      `MCP_OAUTH_OIDC_AUDIENCE names "${audience}", which is no https URL: a client's id (the audience of its ID tokens) or another app's id can be such an audience, so its tokens need a scope only Pulse's clients get. Name that scope in MCP_OAUTH_OIDC_SCOPES.`,
    )
  })

  it("takes such an audience beside a required scope", () => {
    const settings = readOidcSettings(ISSUER, { audience: "0oa1b2c3", scopes: "pulse" })
    expect(settings.audiences).toEqual(["0oa1b2c3"])
    expect(settings.scopes).toEqual(["pulse"])
  })
})

describe("readOidcSettings: the caller claim", () => {
  it.each(["uid", "oid", "sub", "objectguid"])("takes %s", (claim) => {
    expect(readOidcSettings(ISSUER, { subjectClaim: claim }).subjectClaim).toBe(claim)
  })

  it.each(["email", "upn", "unique_name", "preferred_username", "name", "Email", "UPN"])(
    "refuses %s, whose value can change or pass to another person",
    (claim) => {
      expect(refusal(() => readOidcSettings(ISSUER, { subjectClaim: claim }))).toBe(
        `MCP_OAUTH_OIDC_SUBJECT_CLAIM "${claim}" names a claim whose value can change or pass to another person (an address or a name), so it cannot name the caller: name an id the provider never reuses, such as sub, oid or uid.`,
      )
    },
  )

  it.each(["sub oid", "sub,oid", "sub\toid"])("refuses %j, more than one claim", (claim) => {
    expect(refusal(() => readOidcSettings(ISSUER, { subjectClaim: claim }))).toBe(
      "MCP_OAUTH_OIDC_SUBJECT_CLAIM must name one claim.",
    )
  })
})

describe("readOidcSettings: the algorithms", () => {
  it("takes each asymmetric algorithm the gate knows", () => {
    const all = ALGORITHMS.split(", ")
    expect(readOidcSettings(ISSUER, { algorithms: all.join(",") }).algorithms).toEqual(all)
  })

  it.each<[string, string]>([
    ["HS256", "signs with a secret the server would share"],
    ["hs512", "signs with a secret the server would share"],
    ["none", "signs nothing"],
    ["NONE", "signs nothing"],
    ["RS265", "is no algorithm the gate knows"],
    ["rs256", "is no algorithm the gate knows"],
    ["XHS256", "is no algorithm the gate knows"],
  ])("refuses %s, which %s", (algorithm, why) => {
    expect(refusal(() => readOidcSettings(ISSUER, { algorithms: `RS256,${algorithm}` }))).toBe(
      `MCP_OAUTH_OIDC_ALGORITHMS names ${algorithm}, which ${why}: name asymmetric algorithms only (${ALGORITHMS}).`,
    )
  })
})

describe("oauthOidcProvider: what it serves and says", () => {
  const log = () => {}

  it("names its issuer alone, the caller claim, the required scopes and no web client", () => {
    const settings = readOidcSettings(`${ISSUER}/`, { scopes: "pulse", subjectClaim: "uid" })
    const provider = oauthOidcProvider(settings, { log })
    expect(provider.oauthMetadata).toEqual({ issuer: `${ISSUER}/` })
    expect(provider.requiredScopes).toEqual(["pulse"])
    expect(provider.callerClaims).toEqual(["uid"])
    expect(provider.web).toBeUndefined()
    expect(typeof provider.discovery?.server).toBe("function")
    expect(typeof provider.discovery?.keys).toBe("function")
  })

  it.each<[Record<string, string>, string]>([
    [{}, "aud http://localhost/mcp (RFC 8707) and the sub claim"],
    [
      { audience: "https://api.example.test,0oa1", scopes: "pulse", subjectClaim: "uid" },
      "aud http://localhost/mcp (RFC 8707) or https://api.example.test or 0oa1, the scope pulse and the uid claim",
    ],
    [
      { scopes: "pulse.read pulse.write", clientIds: "claude,vscode", subjectClaim: "oid" },
      "aud http://localhost/mcp (RFC 8707), the scopes pulse.read and pulse.write, a client id claude or vscode and the oid claim",
    ],
  ])("says in the boot line what a token must carry: %j", (values, carried) => {
    const provider = oauthOidcProvider(readOidcSettings(ISSUER, values), { log })
    expect(describeOAuthTokens(provider, RESOURCE)).toBe(`OAuth: tokens must carry ${carried}.`)
  })

  it("maps the caller by its claim, and names none without it", () => {
    const provider = oauthOidcProvider(readOidcSettings(ISSUER, { subjectClaim: "uid" }), { log })
    const info = (payload: Record<string, unknown>) => ({
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { payload },
    })
    expect(provider.mapAuthInfo(info({ uid: "u-1", sub: "alice@example.test" })).user).toEqual({
      id: "u-1",
    })
    expect(() => provider.mapAuthInfo(info({ sub: "u-1" }))).toThrow(
      "Missing OpenID Connect subject",
    )
  })
})

describe("oauthOidcProvider: the gate over its discovery", () => {
  let idp: Idp
  let time: number
  const logged: string[] = []
  beforeAll(async () => {
    idp = await startIdp()
  })
  afterAll(() => idp.close())
  afterEach(() => {
    resetIdp(idp)
    logged.length = 0
    vi.restoreAllMocks()
  })

  const discoveryPath = () => `${new URL(idp.issuer).pathname}/.well-known/openid-configuration`
  const TRUST = "http://fs.example.test/adfs/services/trust"

  /** The provider's document: the issuer, the key set at `jwks`, then `extra`. */
  function serve(jwks = "/a/keys", extra: Record<string, unknown> = {}) {
    idp.sets[discoveryPath()] = { issuer: idp.issuer, jwks_uri: `${idp.url}${jwks}`, ...extra }
  }

  /** The provider's gate over its settings, on a clock the test moves. */
  function gate(values: Record<string, string> = {}, debug = false) {
    time = 1_800_000_000_000
    const platform = { fetch: globalThis.fetch, now: () => time }
    const settings = readOidcSettings(idp.issuer, values)
    const provider = oauthOidcProvider(settings, {
      log: (line) => logged.push(line),
      platform,
      debug,
    })
    return provider.createTokenVerifier(RESOURCE)
  }

  const token = (claims: Record<string, unknown> = {}, options = {}) =>
    sign({ iss: idp.issuer, aud: RESOURCE.href, sub: "u-1", exp: now() + 3600, ...claims }, options)

  const discoveries = () => idp.paths.filter((path) => path === discoveryPath()).length
  const keyReads = (path = "/a/keys") => idp.paths.filter((asked) => asked === path).length

  it("answers 503 until its discovery answers, says why once, then verifies", async () => {
    idp.sets[discoveryPath()] = { issuer: "https://other.example.test" }
    const verifier = gate()
    const refused = await verifier.verifyAccessToken(token()).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(OAuthError)
    expect((refused as OAuthError).code).toBe("temporarily_unavailable")
    expect((refused as OAuthError).message).toBe(
      `The signing keys of ${idp.issuer} are not known yet, so no token can be verified. Retry shortly.`,
    )
    expect(logged).toEqual([
      `OAuth: the discovery of ${idp.issuer} failed: the document cannot be used (other-issuer). Until it answers, /mcp answers 503 (temporarily_unavailable).`,
    ])
    serve()
    expect(await verifier.verifyAccessToken(token())).toMatchObject({ resource: RESOURCE })
  })

  it("verifies tokens of the issuer with one read of the document and one of the key set", async () => {
    serve()
    const verifier = gate()
    await verifier.verifyAccessToken(token())
    await verifier.verifyAccessToken(token({ sub: "u-2" }))
    expect(discoveries()).toBe(1)
    expect(keyReads()).toBe(1)
  })

  it("takes tokens of the access tokens' issuer the discovery names beside the issuer (ADFS)", async () => {
    serve("/a/keys", { access_token_issuer: TRUST })
    const verifier = gate()
    expect(await verifier.verifyAccessToken(token({ iss: TRUST }))).toMatchObject({
      clientId: "",
    })
    expect(await verifier.verifyAccessToken(token())).toMatchObject({ resource: RESOURCE })
    await expect(
      verifier.verifyAccessToken(token({ iss: "https://elsewhere.example.test" })),
    ).rejects.toThrow("JWT verification failed")
  })

  it("refuses a token without an issuer, and one of the access tokens' issuer the discovery does not name", async () => {
    serve()
    const verifier = gate()
    await expect(verifier.verifyAccessToken(token({ iss: undefined }))).rejects.toThrow(
      "JWT verification failed",
    )
    await expect(verifier.verifyAccessToken(token({ iss: TRUST }))).rejects.toThrow(
      "JWT verification failed",
    )
  })

  it("reads the key set the document names anew an hour later", async () => {
    idp.sets["/a/keys"] = { keys: [JWK_RSA] }
    idp.sets["/b/keys"] = { keys: [JWK_RSA2] }
    serve("/a/keys")
    const verifier = gate()
    const second = token({}, { key: rsa2.privateKey, kid: "k2" })
    await expect(verifier.verifyAccessToken(second)).rejects.toThrow("JWT verification failed")
    serve("/b/keys")
    time += DISCOVERY_HOLD_MS
    expect(await verifier.verifyAccessToken(second)).toMatchObject({ resource: RESOURCE })
    expect(keyReads("/b/keys")).toBe(1)
  })

  it("narrows the algorithms, the audiences and the clients as its settings name them", async () => {
    idp.keys = [JWK_RSA, JWK_EC]
    serve()
    const narrowed = gate({ algorithms: "ES256" })
    await expect(narrowed.verifyAccessToken(token())).rejects.toThrow("JWT verification failed")
    const es = token({}, { key: ec.privateKey, alg: "ES256", kid: "e1" })
    expect(await narrowed.verifyAccessToken(es)).toMatchObject({ resource: RESOURCE })

    const audiences = gate({ audience: "https://api.example.test" })
    const api = token({ aud: "https://api.example.test" })
    expect(await audiences.verifyAccessToken(api)).toMatchObject({ resource: RESOURCE })
    await expect(
      audiences.verifyAccessToken(token({ aud: "https://x.example.test" })),
    ).rejects.toThrow("Token audience does not include the protected resource")

    const clients = gate({ clientIds: "claude" })
    expect(await clients.verifyAccessToken(token({ appid: "claude" }))).toMatchObject({
      clientId: "claude",
    })
    await expect(clients.verifyAccessToken(token({ appid: "other" }))).rejects.toThrow(
      "Token was issued to a client this server does not accept",
    )
  })

  it("names the caller by its caller claim alone", async () => {
    serve()
    const verifier = gate({ subjectClaim: "uid" })
    const verified = await verifier.verifyAccessToken(token({ uid: "u-9" }))
    expect(verified.extra?.payload).toMatchObject({ uid: "u-9" })
    await expect(verifier.verifyAccessToken(token())).rejects.toThrow("JWT verification failed")
  })

  it("logs why a token was refused with the debug switch, and only then", async () => {
    serve()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    await gate()
      .verifyAccessToken(token({ sub: undefined }))
      .catch(() => {})
    expect(errors).not.toHaveBeenCalled()
    await gate({}, true)
      .verifyAccessToken(token({ sub: undefined }))
      .catch(() => {})
    expect(errors.mock.calls.map(([line]) => String(line))).toContain(
      "[oauth-debug] claim=sub reason=missing",
    )
  })
})

describe("oauthOidcProvider on the network", () => {
  it("discovers through the network without a platform of its own", async () => {
    const idp = await startIdp()
    try {
      const path = `${new URL(idp.issuer).pathname}/.well-known/openid-configuration`
      idp.sets[path] = { issuer: idp.issuer, jwks_uri: `${idp.url}/keys` }
      const provider = oauthOidcProvider(readOidcSettings(idp.issuer, {}), { log: () => {} })
      const verified = await provider
        .createTokenVerifier(RESOURCE)
        .verifyAccessToken(
          sign({ iss: idp.issuer, aud: RESOURCE.href, sub: "u-1", exp: now() + 60 }),
        )
      expect(verified).toMatchObject({ resource: RESOURCE })
    } finally {
      await idp.close()
    }
  })
})
