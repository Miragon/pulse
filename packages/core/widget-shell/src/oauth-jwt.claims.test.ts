import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import { createJwtVerifier, type JwtVerifierOptions } from "./oauth-jwt.js"
import { now, resetIdp, sign, startIdp, type Idp } from "./oauth-jwt.test-support.js"
import { isAudienceRefusal } from "./oauth-shared.js"

/**
 * What the verifier asks of a token's claims beyond the table providers' defaults: audiences beside
 * the resource or without it, and the claims a provider requires (Keycloak's `sid`).
 */

const RESOURCE = new URL("http://localhost/mcp")
const AUD = RESOURCE.href

let idp: Idp

beforeAll(async () => {
  idp = await startIdp()
})

afterAll(() => idp.close())

afterEach(() => resetIdp(idp))

const verifierOf = (options: Partial<JwtVerifierOptions> = {}): OAuthTokenVerifier =>
  createJwtVerifier({
    keySets: [{ issuer: `${idp.url}/a`, jwks: new URL(`${idp.url}/a/keys`) }],
    resource: RESOURCE,
    ...options,
  })

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

const served = (verifier: OAuthTokenVerifier, token: string): Promise<AuthInfo> =>
  verifier.verifyAccessToken(token)

describe("the audience", () => {
  it("accepts an aud of the provider's audiences beside the resource, bound to the resource", async () => {
    const verifier = verifierOf({ audiences: ["api://pulse", "0000-guid"] })
    const byGuid = await served(verifier, sign(good({ aud: "0000-guid" })))
    expect(byGuid.resource?.href).toBe(AUD)
    expect(await served(verifier, sign(good({ aud: ["x", "api://pulse"] })))).toBeDefined()
    expect(await served(verifier, sign(good()))).toBeDefined()
    expect(await refusal(verifier, sign(good({ aud: "other" })))).toEqual({
      code: "invalid_token",
      description: "Token audience does not include the protected resource",
      audience: true,
    })
    expect(await refusal(verifier, sign(good({ resource: "api://pulse" })))).toMatchObject({
      description: "Token resource claim does not match protected resource",
      audience: true,
    })
  })
})

describe("the audience of a provider that leaves the resource out", () => {
  it("takes only its own audiences, neither the resource as aud nor a resource claim naming it", async () => {
    const verifier = verifierOf({
      audiences: ["0000-guid", "api://pulse"],
      resourceAudience: false,
    })
    expect((await served(verifier, sign(good({ aud: "0000-guid" })))).resource?.href).toBe(AUD)
    expect(await served(verifier, sign(good({ aud: [AUD, "api://pulse"] })))).toBeDefined()
    const refused = {
      code: "invalid_token",
      description: "Token audience does not include the protected resource",
      audience: true,
    }
    expect(await refusal(verifier, sign(good()))).toEqual(refused)
    expect(await refusal(verifier, sign(good({ aud: "other", resource: AUD })))).toEqual(refused)
    expect(await served(verifier, sign(good({ aud: "0000-guid", resource: "x" })))).toBeDefined()
  })

  it("takes the resource where the provider names it among its audiences", async () => {
    const verifier = verifierOf({ audiences: ["0000-guid", AUD], resourceAudience: false })
    expect((await served(verifier, sign(good()))).resource?.href).toBe(AUD)
  })
})

describe("the claims a provider requires", () => {
  it("refuses a token without one of them, or with one that holds no value", async () => {
    const verifier = verifierOf({ requiredClaims: ["sid", "uid"] })
    expect(await served(verifier, sign(good({ sid: "s", uid: 7 })))).toBeDefined()
    for (const [claims, missing] of [
      [{ uid: "u" }, "sid"],
      [{ sid: "s" }, "uid"],
      [{ sid: null, uid: "u" }, "sid"],
      [{ sid: "  ", uid: "u" }, "sid"],
      [{ sid: "", uid: "u" }, "sid"],
    ] as const) {
      expect(await refusal(verifier, sign(good(claims))), missing).toEqual({
        code: "invalid_token",
        description: `Token carries no ${missing} claim, which the server requires: it takes only the tokens of a user's sign-in at the identity provider, never a client's own token (client credentials) or a password grant's`,
        audience: false,
      })
    }
  })

  it("checks the audience first, so a token for another server says so", async () => {
    const verifier = verifierOf({ requiredClaims: ["sid"] })
    expect(await refusal(verifier, sign(good({ aud: "other" })))).toMatchObject({
      audience: true,
    })
  })
})
