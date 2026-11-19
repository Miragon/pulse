import { createHash } from "node:crypto"
import { decodeJwt, decodeProtectedHeader } from "jose"
import { afterEach, describe, expect, it } from "vitest"
import { requestToken, TokenFailure } from "@miragon/pulse-http/oauth"
import { oauthKeycloakProvider } from "../../oauth-providers.js"
import { startFakeOidc, type FakeOidc } from "./fake-oidc.js"
import { FAKE_OIDC_USERS } from "./realm.js"
import {
  metadataOf,
  platform,
  REDIRECT_URI,
  RESOURCE,
  signIn,
  startSignIn,
  tokenEndpointOf,
  FAKE_PROVIDER,
} from "./fake-oidc.test-support.js"

let fake: FakeOidc | undefined
const start = async (options?: Parameters<typeof startFakeOidc>[0]) => {
  fake = await startFakeOidc(options)
  return fake
}
afterEach(async () => {
  await fake?.close()
  fake = undefined
})

const [ALICE, BOB] = FAKE_OIDC_USERS

describe("the fake provider's discovery", FAKE_PROVIDER, () => {
  it("is Keycloak's realm on a loopback port, and a confidential client of pulse-http can use it", async () => {
    const idp = await start({ realm: "platform" })
    expect(idp.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(idp.realm).toBe("platform")
    expect(idp.issuer).toBe(`${idp.serverUrl}/realms/platform`)
    const prefix = `${idp.issuer}/protocol/openid-connect`
    expect(await metadataOf(idp)).toEqual({
      issuer: idp.issuer,
      authorizationEndpoint: `${prefix}/auth`,
      tokenEndpoint: `${prefix}/token`,
      revocationEndpoint: `${prefix}/revoke`,
      endSessionEndpoint: `${prefix}/logout`,
      issParameterRequired: true,
      clientAuth: "basic",
    })
  })

  it("serves its signing key, which the boot's Keycloak provider verifies its access tokens with", async () => {
    const idp = await start({ audience: RESOURCE })
    const keys = (await (await fetch(`${idp.issuer}/protocol/openid-connect/certs`)).json()) as {
      keys: { kid: string; alg: string; use: string; kty: string; d?: string }[]
    }
    expect(keys.keys).toHaveLength(1)
    expect(keys.keys[0]).toMatchObject({
      kid: "fake-oidc-rs256",
      alg: "RS256",
      use: "sig",
      kty: "RSA",
    })
    expect(keys.keys[0].d).toBeUndefined()
    const tokens = await signIn(idp)
    const provider = oauthKeycloakProvider({ serverUrl: idp.serverUrl, realm: idp.realm })
    const verified = await provider
      .createTokenVerifier(new URL(RESOURCE))
      .verifyAccessToken(tokens.accessToken)
    expect(provider.mapAuthInfo(verified).user).toEqual({ id: ALICE.sub })
    expect(verified.clientId).toBe("pulse-web")
    expect(verified.scopes).toEqual(["openid", "profile"])
  })
})

describe("a sign-in at the fake provider", FAKE_PROVIDER, () => {
  it("shows a login page that offers each user and a way to cancel", async () => {
    const idp = await start()
    const { url } = await startSignIn(await metadataOf(idp))
    const page = await fetch(url)
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
    const html = await page.text()
    expect(html).toContain("<title>Sign in</title>")
    expect(html).toContain(">alice</a>")
    expect(html).toContain(">bob</a>")
    expect(html).toContain("fake_user=alice")
    expect(html).toContain("fake_decline=1")
    expect(html).toContain(">Cancel</a>")
    expect(html).not.toContain("<script")
  })

  it("returns to the client with a code, the state and the issuer, and a session cookie of its own", async () => {
    const idp = await start()
    const { url, pkce } = await startSignIn(await metadataOf(idp))
    const chosen = new URL(url)
    chosen.searchParams.set("fake_user", "bob")
    const response = await fetch(chosen, { redirect: "manual" })
    expect(response.status).toBe(302)
    const callback = new URL(String(response.headers.get("location")))
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
    expect(callback.searchParams.get("state")).toBe(pkce.state)
    expect(callback.searchParams.get("iss")).toBe(idp.issuer)
    expect(callback.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response.headers.get("set-cookie")).toMatch(
      /^KEYCLOAK_SESSION=[0-9a-f-]{36}; Path=\/realms\/pulse\/; HttpOnly; SameSite=Lax$/,
    )
  })

  it("signs in as the user a test names, by default the first", async () => {
    const idp = await start({ audience: RESOURCE })
    const alice = decodeJwt((await signIn(idp)).accessToken)
    const bob = decodeJwt((await signIn(idp, "bob")).accessToken)
    expect(alice).toMatchObject({
      sub: ALICE.sub,
      preferred_username: "alice",
      name: "Alice Adams",
    })
    expect(bob).toMatchObject({
      sub: BOB.sub,
      preferred_username: "bob",
      email: "bob@example.test",
    })
    expect(alice.sid).not.toBe(bob.sid)
  })

  it("mints Keycloak's tokens: an RS256 access token for the client, a refresh token and an ID token", async () => {
    const idp = await start({ audience: [RESOURCE, "account"], accessTokenSeconds: 60 })
    const tokens = await signIn(idp)
    expect(decodeProtectedHeader(tokens.accessToken)).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: "fake-oidc-rs256",
    })
    const claims = decodeJwt(tokens.accessToken)
    expect(claims).toMatchObject({
      iss: idp.issuer,
      aud: [RESOURCE, "account"],
      typ: "Bearer",
      azp: "pulse-web",
      scope: "openid profile",
    })
    expect(Number(claims.exp) - Number(claims.iat)).toBe(60)
    expect(tokens.expiresAt).toBe(tokens.receivedAt + 60_000)
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokens.refreshExpiresAt).toBe(tokens.receivedAt + 1_800_000)
    const atHash = createHash("sha256").update(tokens.accessToken).digest().subarray(0, 16)
    expect(decodeJwt(String(tokens.idToken))).toMatchObject({
      aud: "pulse-web",
      sub: ALICE.sub,
      typ: "ID",
      at_hash: atHash.toString("base64url"),
    })
    expect(idp.issued).toEqual({
      access: [tokens.accessToken],
      refresh: [tokens.refreshToken],
      id: [tokens.idToken],
    })
  })

  it("adds the audience to its ID tokens as the mapper's Add to ID token does, and the gate refuses them", async () => {
    const plain = await start({ audience: RESOURCE })
    expect(decodeJwt(String((await signIn(plain)).idToken)).aud).toBe("pulse-web")
    await plain.close()
    const idp = await start({ audience: RESOURCE, audienceInIdToken: true })
    const { idToken } = await signIn(idp)
    expect(decodeJwt(String(idToken)).aud).toEqual(["pulse-web", RESOURCE])
    const provider = oauthKeycloakProvider({ serverUrl: idp.serverUrl, realm: idp.realm })
    await expect(
      provider.createTokenVerifier(new URL(RESOURCE)).verifyAccessToken(String(idToken)),
    ).rejects.toThrow("Token is an ID, logout or refresh token, not an access token")
  })

  it("issues no audience without one configured, as Keycloak without its mapper, and the gate refuses that token", async () => {
    const idp = await start()
    const tokens = await signIn(idp, "alice", ["profile"])
    expect(decodeJwt(tokens.accessToken).aud).toBeUndefined()
    expect(tokens.idToken).toBeUndefined()
    const provider = oauthKeycloakProvider({ serverUrl: idp.serverUrl, realm: idp.realm })
    await expect(
      provider.createTokenVerifier(new URL(RESOURCE)).verifyAccessToken(tokens.accessToken),
    ).rejects.toThrow("Token audience claim must be a string or string array")
  })

  it("records each request, the RFC 8707 resource the client named included", async () => {
    const idp = await start()
    await signIn(idp)
    expect(idp.requests.map(({ endpoint, method }) => `${method} ${endpoint}`)).toEqual([
      "GET discovery",
      "GET authorize",
      "POST token",
    ])
    const [, authorize, token] = idp.requests
    expect(authorize.query.getAll("resource")).toEqual([RESOURCE])
    expect(token.form.getAll("resource")).toEqual([RESOURCE])
    expect(token.headers.authorization).toMatch(/^Basic /)
  })

  it("returns access_denied to the client when the user cancels", async () => {
    const idp = await start()
    const { url, pkce } = await startSignIn(await metadataOf(idp))
    const callback = new URL(await idp.decline(url))
    expect(Object.fromEntries(callback.searchParams)).toEqual({
      error: "access_denied",
      state: pkce.state,
      iss: idp.issuer,
    })
  })
})

describe("the fake provider's authorization checks", FAKE_PROVIDER, () => {
  const authorizeWith = async (idp: FakeOidc, change: (query: URLSearchParams) => void) => {
    const { url } = await startSignIn(await metadataOf(idp))
    const changed = new URL(url)
    change(changed.searchParams)
    return changed.href
  }

  it("shows a page instead of returning for an unknown client or a redirect URI it may not use", async () => {
    const idp = await start({
      clients: [{ id: "pulse-web", secret: "s", redirectUris: [REDIRECT_URI] }],
    })
    const unknown = await authorizeWith(idp, (query) => query.set("client_id", "other"))
    await expect(idp.signIn(unknown)).rejects.toThrow("showed a page instead of returning (400)")
    const elsewhere = await authorizeWith(idp, (query) =>
      query.set("redirect_uri", "https://evil.example/cb"),
    )
    await expect(idp.signIn(elsewhere)).rejects.toThrow("Invalid parameter: redirect_uri")
    const notAUrl = await authorizeWith(idp, (query) => query.set("redirect_uri", "not a url"))
    await expect(fake?.signIn(notAUrl)).rejects.toThrow("(400)")
    await expect(idp.signIn(await authorizeWith(idp, () => {}), "mallory")).rejects.toThrow(
      "Invalid username or password.",
    )
  })

  it("refuses back to the client a request without PKCE S256 or for another response type", async () => {
    const idp = await start()
    const plain = await authorizeWith(idp, (query) => query.set("code_challenge_method", "plain"))
    expect(new URL(await idp.signIn(plain)).searchParams.get("error")).toBe("invalid_request")
    const none = await authorizeWith(idp, (query) => query.delete("code_challenge"))
    expect(new URL(await idp.signIn(none)).searchParams.get("error")).toBe("invalid_request")
    const implicit = await authorizeWith(idp, (query) => query.set("response_type", "token"))
    expect(new URL(await idp.signIn(implicit)).searchParams.get("error")).toBe(
      "unsupported_response_type",
    )
  })
})

describe("the fake provider's token endpoint", FAKE_PROVIDER, () => {
  const codeFor = async (idp: FakeOidc) => {
    const metadata = await metadataOf(idp)
    const { url, pkce } = await startSignIn(metadata)
    const code = String(new URL(await idp.signIn(url)).searchParams.get("code"))
    return { metadata, pkce, code }
  }
  const failureOf = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      if (error instanceof TokenFailure) {
        const { kind, status, error: code, description } = error
        return { kind, status, error: code, description }
      }
      throw error
    }
    throw new Error("expected a refusal")
  }

  it("takes the client's secret by client_secret_post too", async () => {
    const idp = await start()
    const { metadata, pkce, code } = await codeFor(idp)
    const grant = {
      type: "authorization_code",
      code,
      redirectUri: REDIRECT_URI,
      verifier: pkce.verifier,
    } as const
    const tokens = await requestToken(tokenEndpointOf(metadata, undefined, "post"), grant, platform)
    expect(tokens.accessToken).toBe(idp.issued.access[0])
    expect(idp.requests.at(-1)?.form.get("client_secret")).toBe("pulse-web-secret")
  })

  it("refuses an unknown client, a wrong secret and a confidential client without one", async () => {
    const idp = await start()
    const { metadata, pkce, code } = await codeFor(idp)
    const grant = {
      type: "authorization_code",
      code,
      redirectUri: REDIRECT_URI,
      verifier: pkce.verifier,
    } as const
    const refused = (client: { id: string; secret?: string }) =>
      failureOf(requestToken(tokenEndpointOf(metadata, client), grant, platform))
    expect(await refused({ id: "other", secret: "x" })).toMatchObject({
      status: 401,
      error: "invalid_client",
    })
    expect(await refused({ id: "pulse-web", secret: "wrong" })).toMatchObject({
      status: 401,
      error: "unauthorized_client",
    })
    expect(await refused({ id: "pulse-web" })).toMatchObject({ error: "unauthorized_client" })
  })

  it("gives a confidential client its service account's token by client credentials: no sid, no user", async () => {
    const idp = await start({ audience: RESOURCE })
    const metadata = await metadataOf(idp)
    const grant = { type: "client_credentials", scopes: ["profile"] } as const
    const tokens = await requestToken(tokenEndpointOf(metadata), grant, platform)
    expect(tokens.refreshToken).toBeUndefined()
    expect(tokens.idToken).toBeUndefined()
    const claims = decodeJwt(tokens.accessToken)
    expect(claims).toMatchObject({
      iss: idp.issuer,
      aud: RESOURCE,
      typ: "Bearer",
      azp: "pulse-web",
      scope: "profile",
      preferred_username: "service-account-pulse-web",
    })
    expect(claims).not.toHaveProperty("sid")
    const again = await requestToken(tokenEndpointOf(metadata), grant, platform)
    expect(decodeJwt(again.accessToken).sub).toBe(claims.sub)
    const provider = oauthKeycloakProvider({ serverUrl: idp.serverUrl, realm: idp.realm })
    await expect(
      provider.createTokenVerifier(new URL(RESOURCE)).verifyAccessToken(tokens.accessToken),
    ).rejects.toThrow("Token carries no sid claim")
    const user = await signIn(idp)
    await expect(
      provider.createTokenVerifier(new URL(RESOURCE)).verifyAccessToken(user.accessToken),
    ).resolves.toMatchObject({ clientId: "pulse-web" })
  })

  it("gives no public client and no other flavor a token by client credentials", async () => {
    const grant = { type: "client_credentials", scopes: [] } as const
    const idp = await start({ clients: [{ id: "pulse-cli" }] })
    const metadata = await metadataOf(idp)
    expect(
      await failureOf(
        requestToken(tokenEndpointOf(metadata, { id: "pulse-cli" }), grant, platform),
      ),
    ).toMatchObject({ status: 400, error: "unauthorized_client" })
    await idp.close()
    const adfs = await start({ flavor: "adfs" })
    expect(
      await failureOf(requestToken(tokenEndpointOf(await metadataOf(adfs)), grant, platform)),
    ).toMatchObject({ status: 400, error: "unauthorized_client" })
  })

  it("takes a public client by its id alone", async () => {
    const idp = await start({ clients: [{ id: "pulse-cli" }] })
    const metadata = await metadataOf(idp)
    const answer = await failureOf(
      requestToken(
        tokenEndpointOf(metadata, { id: "pulse-cli" }),
        { type: "refresh_token", refreshToken: "x" },
        platform,
      ),
    )
    expect(answer).toMatchObject({ status: 400, error: "invalid_grant" })
  })

  it("exchanges a code once, for its redirect URI and its PKCE verifier only", async () => {
    const idp = await start()
    const { metadata, pkce, code } = await codeFor(idp)
    const endpoint = tokenEndpointOf(metadata)
    const exchange = (change: Partial<{ code: string; redirectUri: string; verifier: string }>) =>
      failureOf(
        requestToken(
          endpoint,
          {
            type: "authorization_code",
            code,
            redirectUri: REDIRECT_URI,
            verifier: pkce.verifier,
            ...change,
          },
          platform,
        ),
      )
    expect(await exchange({ verifier: "x".repeat(43) })).toMatchObject({
      error: "invalid_grant",
      description: "PKCE verification failed: Code mismatch",
    })
    const second = await codeFor(idp)
    const again = (change: Parameters<typeof exchange>[0]) =>
      failureOf(
        requestToken(
          endpoint,
          {
            type: "authorization_code",
            code: second.code,
            redirectUri: REDIRECT_URI,
            verifier: second.pkce.verifier,
            ...change,
          },
          platform,
        ),
      )
    expect(await again({ redirectUri: "https://evil.example/cb" })).toMatchObject({
      description: "Incorrect redirect_uri",
    })
    expect(await exchange({})).toMatchObject({ description: "Code not valid" })
    expect(await again({})).toMatchObject({ description: "Code not valid" })
  })
})
