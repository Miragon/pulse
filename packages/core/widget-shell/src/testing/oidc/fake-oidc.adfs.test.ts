import { decodeJwt } from "jose"
import { afterEach, describe, expect, it } from "vitest"
import {
  callbackResult,
  discover,
  keyMetadata,
  requestToken,
  TokenFailure,
} from "@miragon/pulse-http/oauth"
import { startFakeOidc, type FakeOidc } from "./fake-oidc.js"
import {
  metadataOf,
  platform,
  REDIRECT_URI,
  RESOURCE,
  signIn,
  startSignIn,
  tokenEndpointOf,
} from "./fake-oidc.test-support.js"
import { FAKE_OIDC_CLIENT, FAKE_OIDC_USERS } from "./realm.js"

/** The fake provider as ADFS 2019 and later plays it, and what both flavors name for a server. */

let fake: FakeOidc | undefined
const start = async (options: Parameters<typeof startFakeOidc>[0] = {}) => {
  fake = await startFakeOidc({ flavor: "adfs", ...options })
  return fake
}
afterEach(async () => {
  await fake?.close()
  fake = undefined
})

const [ALICE] = FAKE_OIDC_USERS

const refresh = async (idp: FakeOidc, refreshToken: string | undefined, resources?: string[]) =>
  requestToken(
    tokenEndpointOf(await metadataOf(idp)),
    { type: "refresh_token", refreshToken: String(refreshToken), resources },
    platform,
  )

describe("the fake ADFS's discovery", () => {
  it("is ADFS's under /adfs: no PKCE methods, no revocation, no iss, the access tokens' issuer", async () => {
    const idp = await start()
    expect(idp.issuer).toBe(`${idp.serverUrl}/adfs`)
    expect(idp.accessTokenIssuer).toBe(`${idp.serverUrl}/adfs/services/trust`)
    expect(await metadataOf(idp)).toEqual({
      issuer: idp.issuer,
      authorizationEndpoint: `${idp.issuer}/oauth2/authorize/`,
      tokenEndpoint: `${idp.issuer}/oauth2/token/`,
      endSessionEndpoint: `${idp.issuer}/oauth2/logout`,
      issParameterRequired: false,
      clientAuth: "basic",
    })
    const [answer] = await discover(idp.issuer, platform)
    expect(answer.json).not.toHaveProperty("code_challenge_methods_supported")
    const keys = keyMetadata(answer.json ?? {}, idp.issuer, { isLoopback: () => true })
    expect(keys).toEqual({
      issuer: idp.issuer,
      jwksUri: `${idp.issuer}/discovery/keys`,
      accessTokenIssuer: idp.accessTokenIssuer,
    })
    const set = (await (await fetch(`${idp.issuer}/discovery/keys`)).json()) as { keys: unknown[] }
    expect(set.keys).toHaveLength(1)
    expect((await fetch(`${idp.issuer}/protocol/openid-connect/revoke`)).status).toBe(404)
  })
})

describe("a sign-in at the fake ADFS", () => {
  it("returns to the client without iss, and refuses a request for two resources", async () => {
    const idp = await start()
    const { url } = await startSignIn(await metadataOf(idp))
    const back = new URL(await idp.signIn(url))
    expect(back.searchParams.has("code")).toBe(true)
    expect(back.searchParams.has("iss")).toBe(false)
    const two = new URL(url)
    two.searchParams.append("resource", "https://other.example.test/api")
    const refused = new URL(await idp.signIn(two.href))
    expect(refused.searchParams.get("error")).toBe("invalid_request")
  })

  it("issues an access token of its access tokens' issuer for the resource, without a caller", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    expect(decodeJwt(tokens.accessToken)).toMatchObject({
      iss: idp.accessTokenIssuer,
      aud: RESOURCE,
      scp: "openid profile",
      appid: FAKE_OIDC_CLIENT.id,
      ver: "1.0",
    })
    expect(decodeJwt(tokens.accessToken)).not.toHaveProperty("sub")
    expect(decodeJwt(tokens.accessToken)).not.toHaveProperty("upn")
    expect(tokens.refreshToken).toBeDefined()
    expect(tokens.refreshExpiresAt).toBe(tokens.receivedAt + 1_800_000)
  })

  it("names the caller in the claim its issuance rule emits, with the upn", async () => {
    const idp = await start({ callerClaim: "sub" })
    const claims = decodeJwt((await signIn(idp)).accessToken)
    expect(claims).toMatchObject({ sub: ALICE.sub, upn: ALICE.email })
  })

  it("hashes the ID token's subject per client, which names the user by upn and unique_name", async () => {
    const idp = await start({ callerClaim: "sub" })
    const claims = decodeJwt(String((await signIn(idp)).idToken))
    expect(claims).toMatchObject({
      iss: idp.issuer,
      aud: FAKE_OIDC_CLIENT.id,
      upn: ALICE.email,
      unique_name: `PULSE\\${ALICE.username}`,
    })
    expect(claims.sub).not.toBe(ALICE.sub)
    expect(claims.sub).toMatch(/^[A-Za-z0-9+/]{43}=$/)
  })

  it("gives the userinfo audience to a code exchange that names no resource anywhere", async () => {
    const idp = await start()
    const metadata = await metadataOf(idp)
    const { url, pkce } = await startSignIn(metadata)
    const authorization = new URL(url)
    authorization.searchParams.delete("resource")
    const callback = new URL(await idp.signIn(authorization.href))
    const result = callbackResult(callback.searchParams, { state: pkce.state, issuer: idp.issuer })
    if (!("code" in result)) throw new Error(result.problem)
    const tokens = await requestToken(
      tokenEndpointOf(metadata),
      {
        type: "authorization_code",
        code: result.code,
        redirectUri: REDIRECT_URI,
        verifier: pkce.verifier,
      },
      platform,
    )
    expect(decodeJwt(tokens.accessToken).aud).toBe("urn:microsoft:userinfo")
  })
})

describe("a refresh at the fake ADFS", () => {
  it("renews for the resource it names, else for userinfo, and keeps its refresh token", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const named = await refresh(idp, first.refreshToken, [RESOURCE])
    expect(decodeJwt(named.accessToken).aud).toBe(RESOURCE)
    expect(named.refreshToken).toBeUndefined()
    const bare = await refresh(idp, first.refreshToken)
    expect(decodeJwt(bare.accessToken).aud).toBe("urn:microsoft:userinfo")
  })

  it.each(["id_token_hint", "session cookie"] as const)(
    "renews after the session its %s names ended at the end-session endpoint, and not once its grant ended",
    async (by) => {
      const idp = await start()
      const first = await signIn(idp)
      const sid = String(idp.sessionOf(String(first.refreshToken)))
      expect(decodeJwt(String(first.idToken)).sid).toBe(sid)
      const logout = new URL(`${idp.issuer}/oauth2/logout`)
      logout.searchParams.set("client_id", FAKE_OIDC_CLIENT.id)
      logout.searchParams.set("post_logout_redirect_uri", REDIRECT_URI)
      if (by === "id_token_hint") logout.searchParams.set(by, String(first.idToken))
      const headers = by === "session cookie" ? { cookie: `KEYCLOAK_SESSION=${sid}` } : undefined
      const ended = await fetch(logout, { headers, redirect: "manual" })
      expect(ended.status).toBe(302)
      expect(idp.endedSessions).toEqual([
        { clientId: FAKE_OIDC_CLIENT.id, postLogoutRedirectUri: REDIRECT_URI, sid },
      ])
      await expect(refresh(idp, first.refreshToken, [RESOURCE])).resolves.toBeDefined()
      idp.endGrant(sid)
      const refused = await refresh(idp, first.refreshToken, [RESOURCE]).catch(
        (error: unknown) => error,
      )
      expect(refused).toBeInstanceOf(TokenFailure)
      expect((refused as TokenFailure).error).toBe("invalid_grant")
    },
  )

  it("never rotates its refresh tokens, whatever the options ask", async () => {
    const idp = await start({ rotateRefreshTokens: true, revokeFamilyOnReuse: true })
    const first = await signIn(idp)
    await refresh(idp, first.refreshToken, [RESOURCE])
    await expect(refresh(idp, first.refreshToken, [RESOURCE])).resolves.toBeDefined()
  })

  it("issues no refresh token where refresh tokens are off", async () => {
    const idp = await start({ refreshTokens: false })
    expect((await signIn(idp)).refreshToken).toBeUndefined()
  })
})

describe("what the fake names for a server at an origin", () => {
  it("names Keycloak's variables for its default flavor", async () => {
    fake = await startFakeOidc({ realm: "platform" })
    expect(fake.accessTokenIssuer).toBe(fake.issuer)
    expect(fake.env("http://localhost:8400")).toEqual({
      MCP_URL: "http://localhost:8400",
      MCP_OAUTH_KEYCLOAK_SERVER_URL: fake.serverUrl,
      MCP_OAUTH_KEYCLOAK_REALM: "platform",
    })
  })

  it.each<[string | undefined, Record<string, string>]>([
    [undefined, {}],
    ["sub", {}],
    ["uid", { MCP_OAUTH_OIDC_SUBJECT_CLAIM: "uid" }],
  ])(
    "names ADFS's issuer for the generic provider, with the caller claim %s",
    async (claim, more) => {
      const idp = await start(claim === undefined ? {} : { callerClaim: claim })
      expect(idp.env("http://localhost:8400")).toEqual({
        MCP_URL: "http://localhost:8400",
        MCP_OAUTH_OIDC_ISSUER: idp.issuer,
        ...more,
      })
    },
  )

  it("ends a Keycloak session's grant too", async () => {
    fake = await startFakeOidc()
    const first = await signIn(fake)
    fake.endGrant(String(fake.sessionOf(String(first.refreshToken))))
    await expect(refresh(fake, first.refreshToken)).rejects.toBeInstanceOf(TokenFailure)
  })
})
