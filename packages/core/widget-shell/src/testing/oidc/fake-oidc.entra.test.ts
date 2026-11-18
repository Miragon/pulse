import { decodeJwt, decodeProtectedHeader } from "jose"
import { afterEach, describe, expect, it } from "vitest"
import {
  authorizationUrl,
  callbackResult,
  createPkce,
  discover,
  keyMetadata,
  requestToken,
  serverMetadata,
  TokenFailure,
  type ServerMetadata,
  type TokenRecord,
} from "@miragon/pulse-http/oauth"
import { GRAPH } from "./entra.js"
import { startFakeOidc, type FakeEntraTenant, type FakeOidc } from "./fake-oidc.js"
import { platform, REDIRECT_URI, RESOURCE, tokenEndpointOf } from "./fake-oidc.test-support.js"
import { ENTRA_API_CLIENT_ID, ENTRA_TENANT, FAKE_OIDC_CLIENT, FAKE_OIDC_USERS } from "./realm.js"

/** The fake provider as Microsoft Entra ID plays one tenant, through a client of pulse-http. */

let fake: FakeOidc | undefined
const start = async (options: Parameters<typeof startFakeOidc>[0] = {}) => {
  fake = await startFakeOidc({ flavor: "entra", ...options })
  return fake
}
afterEach(async () => {
  await fake?.close()
  fake = undefined
})

const [ALICE] = FAKE_OIDC_USERS
const isLoopback = (host: string) => host === "127.0.0.1"

const tenantOf = (idp: FakeOidc): FakeEntraTenant => {
  if (idp.entra === undefined) throw new Error("no Entra ID tenant")
  return idp.entra
}

/** The API's scope as a client asks for it: the first App ID URI, then the scope. */
const apiScope = (idp: FakeOidc) => `${tenantOf(idp).appIdUris[0]}/${tenantOf(idp).scope}`
const webScopes = (idp: FakeOidc) => ["openid", "profile", "offline_access", apiScope(idp)]

async function documentOf(url: string): Promise<Record<string, unknown>> {
  return (await (await fetch(url)).json()) as Record<string, unknown>
}

/** The metadata of `issuer`'s discovery as a confidential client reads it. */
async function metadataOf(issuer: string): Promise<ServerMetadata> {
  const answers = await discover(issuer, platform)
  const metadata = serverMetadata(answers.at(-1)?.json ?? {}, issuer, {
    confidential: true,
    isLoopback,
  })
  if (!("authorizationEndpoint" in metadata)) throw new Error(`unusable: ${metadata.problem}`)
  return metadata
}

interface SignInRequest {
  readonly issuer?: string
  readonly scopes?: readonly string[]
  readonly exchangeScopes?: readonly string[]
  readonly resource?: string
}

/** The callback's query of an authorization request at `issuer`'s authority, with its PKCE. */
async function authorize(idp: FakeOidc, request: SignInRequest = {}) {
  const issuer = request.issuer ?? idp.issuer
  const metadata = await metadataOf(issuer)
  const pkce = await createPkce()
  const url = authorizationUrl(metadata.authorizationEndpoint, {
    clientId: FAKE_OIDC_CLIENT.id,
    redirectUri: REDIRECT_URI,
    scopes: request.scopes ?? webScopes(idp),
    ...(request.resource === undefined ? {} : { resources: [request.resource] }),
    challenge: pkce.challenge,
    state: pkce.state,
  })
  const back = new URL(await idp.signIn(url))
  return { metadata, pkce, query: back.searchParams, issuer }
}

/** A whole sign-in at `issuer`'s authority: the code exchanged with the scopes. */
async function signIn(idp: FakeOidc, request: SignInRequest = {}): Promise<TokenRecord> {
  const { metadata, pkce, query, issuer } = await authorize(idp, request)
  const expected = { state: pkce.state, issuer, issRequired: metadata.issParameterRequired }
  const result = callbackResult(query, expected)
  if (!("code" in result)) throw new Error(`no code: ${result.problem}`)
  const scopes = request.exchangeScopes ?? request.scopes ?? webScopes(idp)
  return requestToken(
    tokenEndpointOf(metadata),
    {
      type: "authorization_code",
      code: result.code,
      redirectUri: REDIRECT_URI,
      verifier: pkce.verifier,
      ...(scopes.length === 0 ? {} : { scopes }),
      ...(request.resource === undefined ? {} : { resources: [request.resource] }),
    },
    platform,
  )
}

const refresh = async (idp: FakeOidc, refreshToken: string | undefined, scopes?: string[]) =>
  requestToken(
    tokenEndpointOf(await metadataOf(idp.issuer)),
    { type: "refresh_token", refreshToken: String(refreshToken), scopes },
    platform,
  )

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as TokenFailure,
  )

describe("the fake Entra ID's authorities", () => {
  it("names the tenant's v2.0 authority its issuer, and the oauth21 one beside it", async () => {
    const idp = await start()
    expect(idp.issuer).toBe(`${idp.serverUrl}/${ENTRA_TENANT}/v2.0`)
    expect(idp.accessTokenIssuer).toBe(idp.issuer)
    expect(idp.entra).toEqual({
      tenant: ENTRA_TENANT,
      oauth21Issuer: `${idp.serverUrl}/${ENTRA_TENANT}/oauth21/2026-08`,
      apiClientId: ENTRA_API_CLIENT_ID,
      appIdUris: [`api://${ENTRA_API_CLIENT_ID}`],
      scope: "user_impersonation",
    })
  })

  it("discovers v2.0 without PKCE methods, revocation or iss, and with the end of a session", async () => {
    const idp = await start({ tenant: "11111111-2222-4333-8444-555555555555" })
    const base = `${idp.serverUrl}/11111111-2222-4333-8444-555555555555`
    expect(await metadataOf(idp.issuer)).toEqual({
      issuer: idp.issuer,
      authorizationEndpoint: `${base}/oauth2/v2.0/authorize`,
      tokenEndpoint: `${base}/oauth2/v2.0/token`,
      endSessionEndpoint: `${base}/oauth2/v2.0/logout`,
      issParameterRequired: false,
      clientAuth: "basic",
    })
    const [answer] = await discover(idp.issuer, platform)
    expect(answer.json).not.toHaveProperty("code_challenge_methods_supported")
    expect(answer.json).not.toHaveProperty("revocation_endpoint")
    expect(keyMetadata(answer.json ?? {}, idp.issuer, { isLoopback })).toEqual({
      issuer: idp.issuer,
      jwksUri: `${base}/discovery/v2.0/keys`,
    })
  })

  it("discovers oauth21 with PKCE methods and the iss, also at the RFC 8414 path", async () => {
    const idp = await start()
    const { oauth21Issuer, tenant } = tenantOf(idp)
    expect(await metadataOf(oauth21Issuer)).toEqual({
      issuer: oauth21Issuer,
      authorizationEndpoint: `${oauth21Issuer}/authorize`,
      tokenEndpoint: `${oauth21Issuer}/token`,
      endSessionEndpoint: `${oauth21Issuer}/logout`,
      issParameterRequired: true,
      clientAuth: "basic",
    })
    const appended = await documentOf(`${oauth21Issuer}/.well-known/openid-configuration`)
    expect(appended.code_challenge_methods_supported).toEqual(["plain", "S256"])
    const inserted = `${idp.serverUrl}/.well-known/oauth-authorization-server/${tenant}/oauth21/2026-08`
    expect(await documentOf(inserted)).toEqual(appended)
    const notServed = `${idp.issuer}/.well-known/oauth-authorization-server`
    expect((await fetch(notServed)).status).toBe(404)
    expect((await fetch(`${idp.issuer}/protocol/openid-connect/revoke`)).status).toBe(404)
  })

  it("tags each key with its authority, the oauth21 set holding a key the v2.0 one lacks", async () => {
    const idp = await start()
    const { oauth21Issuer, tenant } = tenantOf(idp)
    type Keys = { keys: { kid: string; issuer: string }[] }
    const v2 = (await documentOf(`${idp.serverUrl}/${tenant}/discovery/v2.0/keys`)) as Keys
    const o21 = (await documentOf(`${oauth21Issuer}/keys`)) as Keys
    expect(v2.keys.map(({ kid, issuer }) => [kid, issuer])).toEqual([
      ["fake-oidc-rs256", idp.issuer],
    ])
    expect(o21.keys.map(({ kid, issuer }) => [kid, issuer])).toEqual([
      ["fake-oidc-rs256", oauth21Issuer],
      ["fake-oidc-oauth21", oauth21Issuer],
    ])
  })
})

describe("a sign-in at the fake Entra ID", () => {
  it("issues a v2 access token for the API: its client id, the short scope, a hashed sub and no resource needed", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    expect(decodeProtectedHeader(tokens.accessToken).kid).toBe("fake-oidc-rs256")
    const claims = decodeJwt(tokens.accessToken)
    expect(claims).toMatchObject({
      iss: idp.issuer,
      aud: ENTRA_API_CLIENT_ID,
      scp: "user_impersonation",
      ver: "2.0",
      azp: FAKE_OIDC_CLIENT.id,
      azpacr: "1",
      name: ALICE.name,
      preferred_username: ALICE.email,
      oid: ALICE.sub,
      tid: ENTRA_TENANT,
    })
    expect(claims.sub).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(claims.sub).not.toBe(ALICE.sub)
    expect(claims).not.toHaveProperty("scope")
    expect(claims).not.toHaveProperty("groups")
    expect(tokens.refreshToken).toBeDefined()
    expect(tokens.refreshExpiresAt).toBeUndefined()
  })

  it("comes to about 2.5 KB a token, and with group claims carries 200 group ids", async () => {
    const plain = (await signIn(await start())).accessToken
    expect(plain.length).toBeGreaterThan(2_300)
    expect(plain.length).toBeLessThan(2_700)
    await fake?.close()
    const grouped = decodeJwt((await signIn(await start({ groups: true }))).accessToken)
    const groups = grouped.groups as string[]
    expect(groups).toHaveLength(200)
    expect(new Set(groups).size).toBe(200)
    for (const id of groups) expect(id).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
  })

  it("names oid and tid only where profile was asked, as Microsoft documents", async () => {
    const idp = await start()
    const scopes = ["openid", "offline_access", apiScope(idp)]
    const tokens = await signIn(idp, { scopes })
    for (const token of [tokens.accessToken, String(tokens.idToken)]) {
      expect(decodeJwt(token)).not.toHaveProperty("oid")
    }
    expect(decodeJwt(tokens.accessToken)).not.toHaveProperty("tid")
    expect(decodeJwt(tokens.accessToken)).toMatchObject({ name: ALICE.name })
    expect(decodeJwt(String(tokens.idToken))).toMatchObject({ tid: ENTRA_TENANT })
    expect(decodeJwt(String(tokens.idToken))).not.toHaveProperty("name")
  })

  it("issues an ID token for the client, with the access token's hashed sub and the oid", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    const id = decodeJwt(String(tokens.idToken))
    expect(id).toMatchObject({
      iss: idp.issuer,
      aud: FAKE_OIDC_CLIENT.id,
      ver: "2.0",
      oid: ALICE.sub,
      name: ALICE.name,
      sub: decodeJwt(tokens.accessToken).sub,
    })
    expect(id).not.toHaveProperty("at_hash")
    expect(idp.issued.id).toEqual([tokens.idToken])
  })

  it("gives Microsoft Graph's token to a sign-in whose scopes name no API", async () => {
    const idp = await start()
    const tokens = await signIn(idp, { scopes: ["openid", "profile", "email"] })
    expect(decodeJwt(tokens.accessToken)).toMatchObject({ aud: GRAPH, scp: "openid profile email" })
    expect(tokens.refreshToken).toBeUndefined()
  })

  it("reads .default as the API's scope", async () => {
    const idp = await start()
    const scopes = ["openid", `${tenantOf(idp).appIdUris[0]}/.default`]
    const claims = decodeJwt((await signIn(idp, { scopes })).accessToken)
    expect(claims).toMatchObject({ aud: ENTRA_API_CLIENT_ID, scp: "user_impersonation" })
  })

  it("signs the oauth21 authority's tokens with its own key and names it, and returns its iss", async () => {
    const idp = await start()
    const { oauth21Issuer } = tenantOf(idp)
    const { query } = await authorize(idp, { issuer: oauth21Issuer })
    expect(query.get("iss")).toBe(oauth21Issuer)
    const tokens = await signIn(idp, { issuer: oauth21Issuer })
    for (const token of [tokens.accessToken, String(tokens.idToken)]) {
      expect(decodeProtectedHeader(token).kid).toBe("fake-oidc-oauth21")
      expect(decodeJwt(token).iss).toBe(oauth21Issuer)
    }
    const fromV2 = await authorize(idp)
    expect(fromV2.query.has("iss")).toBe(false)
  })

  it("issues v1 tokens of sts.windows.net to an API on token version 1", async () => {
    const idp = await start({ tokenVersion: 1 })
    const tokens = await signIn(idp)
    expect(decodeJwt(tokens.accessToken)).toMatchObject({
      iss: `https://sts.windows.net/${ENTRA_TENANT}/`,
      aud: `api://${ENTRA_API_CLIENT_ID}`,
      appid: FAKE_OIDC_CLIENT.id,
      upn: ALICE.email,
      ver: "1.0",
    })
    const named = await signIn(idp, { resource: `api://${ENTRA_API_CLIENT_ID}` })
    expect(decodeJwt(named.accessToken).aud).toBe(`api://${ENTRA_API_CLIENT_ID}`)
  })
})

describe("what the fake Entra ID refuses", () => {
  it("refuses a resource that is no App ID URI of the API, at the authorization request (AADSTS9010010)", async () => {
    const idp = await start()
    const { query } = await authorize(idp, { resource: RESOURCE })
    expect(query.get("error")).toBe("invalid_target")
    expect(query.get("error_description")).toMatch(/^AADSTS9010010: /)
  })

  it("takes a resource that names an App ID URI, the server's URL among them", async () => {
    const idp = await start({ appIdUris: [`api://${ENTRA_API_CLIENT_ID}`, RESOURCE] })
    const tokens = await signIn(idp, { resource: RESOURCE })
    expect(decodeJwt(tokens.accessToken).aud).toBe(ENTRA_API_CLIENT_ID)
  })

  it("refuses a code exchange without a scope (AADSTS28003) or with a resource it does not know", async () => {
    const idp = await start()
    const bare = await failureOf(signIn(idp, { exchangeScopes: [] }))
    expect(bare).toBeInstanceOf(TokenFailure)
    expect(bare).toMatchObject({ status: 400, error: "invalid_request" })
    expect(bare?.description).toMatch(/^AADSTS28003: /)
    const { metadata, pkce, query } = await authorize(idp)
    const target = await failureOf(
      requestToken(
        tokenEndpointOf(metadata),
        {
          type: "authorization_code",
          code: String(query.get("code")),
          redirectUri: REDIRECT_URI,
          verifier: pkce.verifier,
          scopes: webScopes(idp),
          resources: [RESOURCE],
        },
        platform,
      ),
    )
    expect(target).toMatchObject({ status: 400, error: "invalid_target" })
  })
})

describe("a refresh at the fake Entra ID", () => {
  it("rotates its refresh token, and the old one renews on", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const second = await refresh(idp, first.refreshToken, webScopes(idp))
    expect(second.refreshToken).toBeDefined()
    expect(second.refreshToken).not.toBe(first.refreshToken)
    await expect(refresh(idp, first.refreshToken, webScopes(idp))).resolves.toBeDefined()
    expect(idp.sessionOf(String(second.refreshToken))).toBe(
      idp.sessionOf(String(first.refreshToken)),
    )
  })

  it("keeps the grant's scope for a refresh that names none, and refuses a resource it does not know", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const kept = await refresh(idp, first.refreshToken)
    expect(decodeJwt(kept.accessToken)).toMatchObject({ aud: ENTRA_API_CLIENT_ID })
    const refused = await failureOf(
      requestToken(
        tokenEndpointOf(await metadataOf(idp.issuer)),
        { type: "refresh_token", refreshToken: String(first.refreshToken), resources: [RESOURCE] },
        platform,
      ),
    )
    expect(refused).toMatchObject({ status: 400, error: "invalid_target" })
  })

  it("renews after a single sign-out, and not once an admin revoked the sessions", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const sid = String(idp.sessionOf(String(first.refreshToken)))
    const { endSessionEndpoint } = await metadataOf(idp.issuer)
    const logout = new URL(String(endSessionEndpoint))
    logout.searchParams.set("client_id", FAKE_OIDC_CLIENT.id)
    logout.searchParams.set("post_logout_redirect_uri", REDIRECT_URI)
    const headers = { cookie: `KEYCLOAK_SESSION=${sid}` }
    const ended = await fetch(logout, { headers, redirect: "manual" })
    expect(ended.status).toBe(302)
    expect(ended.headers.get("set-cookie")).toContain(`Path=/${ENTRA_TENANT}/;`)
    expect(idp.endedSessions).toEqual([
      { clientId: FAKE_OIDC_CLIENT.id, postLogoutRedirectUri: REDIRECT_URI, sid },
    ])
    await expect(refresh(idp, first.refreshToken)).resolves.toBeDefined()
    idp.refuseRefresh()
    const refused = await failureOf(refresh(idp, first.refreshToken))
    expect(refused).toMatchObject({ error: "invalid_grant" })
  })

  it("issues no refresh token where refresh tokens are off", async () => {
    const idp = await start({ refreshTokens: false })
    expect((await signIn(idp)).refreshToken).toBeUndefined()
  })
})

describe("what the fake Entra ID names for a server", () => {
  it("names no variables of the boot, whose providers read none of its tokens", async () => {
    const idp = await start()
    expect(() => idp.env("http://localhost:8400")).toThrow(
      "The fake Entra ID has no variables of the boot's providers",
    )
  })
})
