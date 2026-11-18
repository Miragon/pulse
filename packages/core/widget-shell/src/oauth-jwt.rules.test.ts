import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import { createJwtVerifier, type JwtKeySet, type JwtVerifierOptions } from "./oauth-jwt.js"
import {
  ec,
  ed,
  jwk,
  JWK_EC,
  JWK_RSA,
  JWK_RSA2,
  now,
  resetIdp,
  rsa,
  rsa2,
  sign,
  startIdp,
  type Idp,
} from "./oauth-jwt.test-support.js"
import { isAudienceRefusal } from "./oauth-shared.js"

/**
 * The verifier's rules beyond the table providers' defaults, on the verifier itself: a key set per
 * issuer (tagged, or found lazily), audiences beside the resource, algorithms, caller claims, scopes
 * from `scp`, the client, and the tokens that are no access tokens.
 */

const RESOURCE = new URL("http://localhost/mcp")
const AUD = RESOURCE.href

let idp: Idp

beforeAll(async () => {
  idp = await startIdp()
})

afterAll(() => idp.close())

afterEach(() => {
  resetIdp(idp)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const keysAt = (path: string, extra: Partial<JwtKeySet> = {}): JwtKeySet => ({
  issuer: `${idp.url}${path.replace(/\/keys$/, "")}`,
  jwks: new URL(`${idp.url}${path}`),
  ...extra,
})

const verifierOf = (options: Partial<JwtVerifierOptions> = {}): OAuthTokenVerifier =>
  createJwtVerifier({ keySets: [keysAt("/a/keys")], resource: RESOURCE, ...options })

const good = (extra: Record<string, unknown> = {}) => ({
  iss: `${idp.url}/a`,
  aud: AUD,
  sub: "u1",
  exp: now() + 3600,
  ...extra,
})

/** The refusal of `token`: its code, its description and whether it is an audience refusal. */
async function refusal(verifier: OAuthTokenVerifier, token: string) {
  const error = await verifier.verifyAccessToken(token).then(
    () => undefined,
    (thrown: unknown) => thrown as { code?: string; message?: string },
  )
  expect(error, "refused").toBeDefined()
  return {
    code: error?.code,
    description: error?.message,
    audience: isAudienceRefusal(error),
  }
}

const FAILED = { code: "invalid_token", description: "JWT verification failed", audience: false }

const served = (verifier: OAuthTokenVerifier, token: string): Promise<AuthInfo> =>
  verifier.verifyAccessToken(token)

describe("the key set of the token's issuer", () => {
  it("checks the signature with the key set its iss picks, and with that set alone", async () => {
    idp.sets = { "/a/keys": { keys: [JWK_RSA] }, "/b/keys": { keys: [JWK_RSA2] } }
    const verifier = verifierOf({ keySets: [keysAt("/a/keys"), keysAt("/b/keys")] })
    const b = `${idp.url}/b`
    expect((await served(verifier, sign(good()))).extra).toMatchObject({ payload: { sub: "u1" } })
    const byB = sign(good({ iss: b }), { key: rsa2.privateKey, kid: "k2" })
    expect((await served(verifier, byB)).extra).toMatchObject({ payload: { iss: b } })
    expect(await refusal(verifier, sign(good(), { key: rsa2.privateKey, kid: "k2" }))).toEqual(
      FAILED,
    )
    expect(await refusal(verifier, sign(good({ iss: b })))).toEqual(FAILED)
    // Each set loaded once: a kid it lacks is the token's failure within jose's cooldown.
    expect(idp.paths.sort()).toEqual(["/a/keys", "/b/keys"])
  })

  it("refuses an iss no set names, or none, before any key set loads", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const verifier = verifierOf({ debug: true })
    expect(await refusal(verifier, sign(good({ iss: `${idp.url}/b` })))).toEqual(FAILED)
    expect(await refusal(verifier, sign(good({ iss: undefined })))).toEqual(FAILED)
    expect(idp.hits).toBe(0)
    const lines = error.mock.calls.map(([line]) => String(line))
    expect(lines.slice(0, 2)).toEqual([
      '[oauth-debug] JWT verify failed: JWTClaimValidationFailed: unexpected "iss" claim value',
      "[oauth-debug] claim=iss reason=check_failed",
    ])
  })
})

describe("a key set whose keys name their issuer", () => {
  const tagged = (path: string, issuer: string, keys: unknown[]) => {
    idp.sets = { [path]: { keys } }
    return verifierOf({
      keySets: [{ issuer, jwks: new URL(`${idp.url}${path}`), taggedKeys: true }],
    })
  }

  it("never uses a key tagged for another issuer, and uses one tagged for its own or untagged", async () => {
    const a = `${idp.url}/a`
    const verifier = tagged("/a/keys", a, [
      { ...JWK_RSA, issuer: `${idp.url}/b` },
      { ...JWK_RSA2, issuer: a },
      JWK_EC,
    ])
    expect(await refusal(verifier, sign(good()))).toEqual(FAILED)
    expect(await served(verifier, sign(good(), { key: rsa2.privateKey, kid: "k2" }))).toBeDefined()
    const byEc = sign(good(), { key: ec.privateKey, alg: "ES256", kid: "e1" })
    expect(await served(verifier, byEc)).toBeDefined()
  })

  it("reads Microsoft's {tenantid} in a tag as the tenant in its place", async () => {
    const issuer = `${idp.url}/tenant-1/v2.0`
    const verifier = tagged("/tenant-1/keys", issuer, [
      { ...JWK_RSA, issuer: `${idp.url}/{tenantid}/v2.0` },
      { ...JWK_RSA2, issuer: `${idp.url}/{tenantid}/oauth21/2026-08` },
    ])
    expect(await served(verifier, sign(good({ iss: issuer })))).toBeDefined()
    const byOauth21Key = sign(good({ iss: issuer }), { key: rsa2.privateKey, kid: "k2" })
    expect(await refusal(verifier, byOauth21Key)).toEqual(FAILED)
  })

  it("never uses a key whose tag is no string", async () => {
    const verifier = tagged("/a/keys", `${idp.url}/a`, [{ ...JWK_RSA, issuer: 7 }])
    expect(await refusal(verifier, sign(good()))).toEqual(FAILED)
  })

  it("reads no tag of a set that is not tagged", async () => {
    idp.sets = { "/a/keys": { keys: [{ ...JWK_RSA, issuer: `${idp.url}/b` }] } }
    expect(await served(verifierOf(), sign(good()))).toBeDefined()
  })

  it.each<[string, { status: number; body: string }, string]>([
    [
      "a key set answered with a 500",
      { status: 500, body: JSON.stringify({ keys: [] }) },
      "Expected 200 OK from the JSON Web Key Set HTTP response",
    ],
    [
      "no JSON",
      { status: 200, body: "<html></html>" },
      "Failed to parse the JSON Web Key Set HTTP response as JSON",
    ],
    ["null", { status: 200, body: "null" }, "JSON Web Key Set malformed"],
    [
      "keys that are no list",
      { status: 200, body: '{"keys":"nope"}' },
      "JSON Web Key Set malformed",
    ],
    ["a key that is null", { status: 200, body: '{"keys":[null]}' }, "JSON Web Key Set malformed"],
  ])("leaves %s to jose, which refuses it in its own words", async (_case, answer, reason) => {
    const verifier = tagged("/a/keys", `${idp.url}/a`, [])
    idp.answer = answer
    const { code, description } = await refusal(verifier, sign(good()))
    expect(code).toBe("temporarily_unavailable")
    expect(description).toBe(
      `The identity provider's signing keys could not be loaded from ${idp.url}/a/keys (${reason}), so no token can be verified. Retry shortly.`,
    )
  })

  it("names a fetch that fails with no Error by what it failed with", async () => {
    const verifier = verifierOf({ keySets: [keysAt("/a/keys", { taggedKeys: true })] })
    // A thenable that fails with a string, as a fetch a library wraps might.
    vi.stubGlobal("fetch", () => ({
      then: (_: unknown, fail: (why: string) => void) => fail("down"),
    }))
    try {
      const { code, description } = await refusal(verifier, sign(good()))
      expect(code).toBe("temporarily_unavailable")
      expect(description).toBe(
        `The identity provider's signing keys could not be loaded from ${idp.url}/a/keys (down), so no token can be verified. Retry shortly.`,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("a key set found lazily", () => {
  it("is temporarily unavailable while its lookup finds no URL", async () => {
    const verifier = verifierOf({
      keySets: [{ issuer: `${idp.url}/a`, jwks: () => Promise.resolve(undefined) }],
    })
    expect(await refusal(verifier, sign(good()))).toEqual({
      code: "temporarily_unavailable",
      description: `The signing keys of ${idp.url}/a are not known yet, so no token can be verified. Retry shortly.`,
      audience: false,
    })
  })

  it("keeps one remote set per URL its lookup finds", async () => {
    idp.sets = { "/a/keys": { keys: [JWK_RSA] }, "/b/keys": { keys: [JWK_RSA2] } }
    let path = "/a/keys"
    const verifier = verifierOf({
      keySets: [
        { issuer: `${idp.url}/a`, jwks: () => Promise.resolve(new URL(`${idp.url}${path}`)) },
      ],
    })
    expect(await served(verifier, sign(good()))).toBeDefined()
    expect(await served(verifier, sign(good()))).toBeDefined()
    expect(idp.paths).toEqual(["/a/keys"])
    path = "/b/keys"
    expect(await served(verifier, sign(good(), { key: rsa2.privateKey, kid: "k2" }))).toBeDefined()
    expect(idp.paths).toEqual(["/a/keys", "/b/keys"])
  })

  it("passes on a lookup that fails as it failed, and logs it with MCP_OAUTH_DEBUG", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    // A thenable that fails with no Error, as a library might.
    const down = { then: (_found: unknown, fail: (reason: unknown) => void) => fail("down") }
    const verifier = verifierOf({
      keySets: [{ issuer: `${idp.url}/a`, jwks: () => down as unknown as Promise<URL> }],
      debug: true,
    })
    await expect(verifier.verifyAccessToken(sign(good()))).rejects.toBe("down")
    // No claim line: the failure is no claim's.
    const lines = error.mock.calls.map(([line]) => String(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe("[oauth-debug] JWT verify failed: string: down")
    expect(lines[1]).toMatch(/^\[oauth-debug\] token=\{/)
  })
})

describe("the algorithms", () => {
  const JWK_ED = jwk(ed.publicKey, { kid: "d1", alg: "Ed25519" })

  it("verifies Ed25519 by its key without a list, never HS256 or none", async () => {
    idp.keys = [JWK_RSA, JWK_ED]
    const verifier = verifierOf()
    const byEd = sign(good(), { key: ed.privateKey, alg: "Ed25519", kid: "d1" })
    expect(await served(verifier, byEd)).toBeDefined()
    const secret = rsa.publicKey.export({ type: "spki", format: "pem" }).toString()
    expect(await refusal(verifier, sign(good(), { alg: "HS256", key: secret }))).toEqual(FAILED)
    expect(await refusal(verifier, sign(good(), { alg: "none" }))).toEqual(FAILED)
  })

  it("narrows to a list", async () => {
    idp.keys = [JWK_RSA, JWK_ED]
    const verifier = verifierOf({ algorithms: ["Ed25519"] })
    expect(
      await served(verifier, sign(good(), { key: ed.privateKey, alg: "Ed25519", kid: "d1" })),
    ).toBeDefined()
    expect(await refusal(verifier, sign(good()))).toEqual(FAILED)
  })
})

describe("the caller claim", () => {
  it("takes the first caller claim a token carries, whatever its value, and refuses none", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const verifier = verifierOf({ callerClaims: ["oid", "sub"], debug: true })
    expect(await served(verifier, sign(good({ sub: undefined, oid: "o1" })))).toBeDefined()
    expect(await served(verifier, sign(good({ oid: null })))).toBeDefined()
    expect(await served(verifier, sign(good()))).toBeDefined()
    expect(await refusal(verifier, sign(good({ sub: undefined })))).toEqual(FAILED)
    const lines = error.mock.calls.map(([line]) => String(line))
    expect(lines.slice(0, 2)).toEqual([
      '[oauth-debug] JWT verify failed: JWTClaimValidationFailed: missing required "oid or sub" claim',
      "[oauth-debug] claim=oid or sub reason=missing",
    ])
  })
})

describe("the scopes", () => {
  it.each<[string, Record<string, unknown>, string | undefined, string[]]>([
    ["scope and scp as strings", { scope: "a", scp: "b c" }, undefined, ["a", "b", "c"]],
    ["scp as an array", { scp: ["d", 7, "", "e"] }, undefined, ["d", "e"]],
    [
      "a short scp value under the prefix, a full one as it is, scope never",
      { scope: "openid", scp: "user_impersonation api://other/x" },
      "api://pulse",
      ["openid", "api://pulse/user_impersonation", "api://other/x"],
    ],
  ])("reads %s", async (_case, claims, scopePrefix, scopes) => {
    const verifier = verifierOf(scopePrefix === undefined ? {} : { scopePrefix })
    expect((await served(verifier, sign(good(claims)))).scopes).toEqual(scopes)
  })
})

describe("the client", () => {
  it.each<[Record<string, unknown>, string]>([
    [{ client_id: "c", azp: "z" }, "c"],
    [{ azp: "z", appid: "a" }, "z"],
    [{ appid: "a", cid: "o" }, "a"],
    [{ appid: " ", cid: "o" }, "o"],
    [{}, ""],
  ])("names the client of %o as %o", async (claims, client) => {
    expect((await served(verifierOf(), sign(good(claims)))).clientId).toBe(client)
  })

  it("refuses a token of a client the provider does not list, or of none", async () => {
    const verifier = verifierOf({ clients: ["web", "cli"] })
    expect((await served(verifier, sign(good({ azp: "cli" })))).clientId).toBe("cli")
    const other = {
      code: "invalid_token",
      description: "Token was issued to a client this server does not accept",
      audience: false,
    }
    expect(await refusal(verifier, sign(good({ azp: "x" })))).toEqual(other)
    expect(await refusal(verifier, sign(good()))).toEqual(other)
  })
})

describe("tokens that are no access tokens", () => {
  it.each<[string, Record<string, unknown>, Record<string, unknown>, string]>([
    ["an ID token by at_hash", { at_hash: "x" }, {}, "its at_hash claim"],
    ["an ID token by c_hash", { c_hash: "x" }, {}, "its c_hash claim"],
    ["a logout token by events", { events: {} }, {}, "its events claim"],
    ["Keycloak's ID token", { typ: "ID" }, {}, "its typ claim ID"],
    ["Keycloak's refresh token", { typ: "Refresh" }, {}, "its typ claim Refresh"],
    ["Keycloak's offline token", { typ: "Offline" }, {}, "its typ claim Offline"],
    ["Keycloak's logout token", { typ: "Logout" }, {}, "its typ claim Logout"],
    ["a logout token by its header", {}, { typ: "logout+jwt" }, "its typ header logout+jwt"],
    [
      "a logout token by its full media type",
      {},
      { typ: "application/logout+jwt" },
      "its typ header application/logout+jwt",
    ],
  ])("refuses %s, whoever signed it", async (_case, claims, header, mark) => {
    const token = sign(good(claims), { header })
    expect(await refusal(verifierOf(), token)).toEqual({
      code: "invalid_token",
      description: `Token is an ID, logout or refresh token, not an access token (${mark})`,
      audience: false,
    })
  })

  it.each<[string, Record<string, unknown>, string | null]>([
    ["Keycloak's access token", { typ: "Bearer" }, "JWT"],
    ["a typ claim that is no string", { typ: 7 }, "JWT"],
    ["a nonce", { nonce: "n" }, "at+jwt"],
    ["no typ header", {}, null],
  ])("serves %s", async (_case, claims, typ) => {
    expect(await served(verifierOf(), sign(good(claims), { typ }))).toBeDefined()
  })
})

describe("the token's own failures", () => {
  it("refuses an exp of this very second, and serves its expiry otherwise", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"))
    const exp = now()
    expect(await refusal(verifierOf(), sign(good({ exp })))).toEqual({
      code: "invalid_token",
      description: "Missing or expired exp claim",
      audience: false,
    })
    expect((await served(verifierOf(), sign(good({ exp: exp + 1 })))).expiresAt).toBe(exp + 1)
  })

  it.each<[string, () => string]>([
    ["an exp an hour past", () => sign(good({ exp: now() - 3600 }))],
    ["a header that is no JSON", () => `eA.${sign(good()).split(".").slice(1).join(".")}`],
  ])("refuses %s as the token's failure", async (_case, token) => {
    expect(await refusal(verifierOf(), token())).toEqual(FAILED)
  })

  it("names the failure of the key that signed a token without kid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    idp.keys = [JWK_RSA, JWK_RSA2]
    const token = sign(good({ exp: now() - 3600 }), { key: rsa2.privateKey, kid: null })
    expect(await refusal(verifierOf({ debug: true }), token)).toEqual(FAILED)
    expect(String(error.mock.calls[0][0])).toMatch(
      /^\[oauth-debug\] JWT verify failed: JWTExpired: /,
    )
  })

  it("answers 503 naming the timeout when the key set does not answer within 5 s", async () => {
    idp.mode = "silent"
    const { code, description } = await refusal(verifierOf(), sign(good()))
    expect(code).toBe("temporarily_unavailable")
    expect(description).toContain("(the request timed out)")
  }, 15_000)
})

describe("MCP_OAUTH_DEBUG: the claims the checks read", () => {
  it("shows each of them and the subject only as set", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const read = {
      iss: `${idp.url}/b`,
      aud: AUD,
      resource: AUD,
      azp: "z",
      client_id: "c",
      appid: "a",
      cid: "o",
      exp: 1,
      nbf: 2,
      iat: 3,
      scope: "s",
      scp: "p",
      ver: "2.0",
      tid: "t",
      idtyp: "user",
      typ: "Bearer",
    }
    await refusal(verifierOf({ debug: true }), sign({ ...read, sub: "secret", oid: "secret" }))
    const line = error.mock.calls.map(([text]) => String(text)).at(-1) ?? ""
    const summary = JSON.parse(line.replace("[oauth-debug] token=", "")) as { now: number }
    expect({ ...summary, now: 0 }).toEqual({
      header: { alg: "RS256", kid: "k1", typ: "JWT" },
      ...read,
      sub: "set",
      now: 0,
    })
    expect(Math.abs(summary.now - now())).toBeLessThanOrEqual(2)
    expect(line).not.toContain("secret")
  })
})
