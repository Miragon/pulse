import { decodeJwt } from "jose"
import { afterEach, describe, expect, it, vi } from "vitest"
import { endSessionUrl, requestToken, revokeToken, TokenFailure } from "@miragon/pulse-http/oauth"
import { startFakeOidc, type FakeOidc } from "./fake-oidc.js"
import {
  metadataOf,
  platform,
  REDIRECT_URI,
  signIn,
  startSignIn,
  tokenEndpointOf,
} from "./fake-oidc.test-support.js"

let fake: FakeOidc | undefined
const start = async (options?: Parameters<typeof startFakeOidc>[0]) => {
  fake = await startFakeOidc(options)
  return fake
}
afterEach(async () => {
  vi.useRealTimers()
  await fake?.close()
  fake = undefined
})

const refresh = async (idp: FakeOidc, refreshToken: string | undefined) =>
  requestToken(
    tokenEndpointOf(await metadataOf(idp)),
    { type: "refresh_token", refreshToken: String(refreshToken) },
    platform,
  )

const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof TokenFailure) return `${error.status} ${error.error}: ${error.description}`
    throw error
  }
  throw new Error("expected a refusal")
}

describe("a refresh at the fake provider", () => {
  it("renews the access token for the same user and session, and the old refresh token renews too", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const renewed = await refresh(idp, first.refreshToken)
    expect(renewed.accessToken).not.toBe(first.accessToken)
    expect(renewed.refreshToken).not.toBe(first.refreshToken)
    const before = decodeJwt(first.accessToken)
    expect(decodeJwt(renewed.accessToken)).toMatchObject({ sub: before.sub, sid: before.sid })
    await expect(refresh(idp, first.refreshToken)).resolves.toBeDefined()
  })

  it("names the session a refresh token belongs to, a renewed one's too, and none for anything else", async () => {
    const idp = await start()
    const first = await signIn(idp)
    const { sid } = decodeJwt(first.accessToken)
    const renewed = await refresh(idp, first.refreshToken)
    const other = await signIn(idp)
    expect(idp.sessionOf(String(first.refreshToken))).toBe(sid)
    expect(idp.sessionOf(String(renewed.refreshToken))).toBe(sid)
    expect(idp.sessionOf(String(other.refreshToken))).toBe(decodeJwt(other.accessToken).sid)
    expect(idp.sessionOf(String(other.refreshToken))).not.toBe(sid)
    expect(idp.sessionOf(first.accessToken)).toBeUndefined()
    expect(idp.sessionOf("unknown")).toBeUndefined()
  })

  it("rotates when told to: a used refresh token is refused", async () => {
    const idp = await start({ rotateRefreshTokens: true })
    const first = await signIn(idp)
    const renewed = await refresh(idp, first.refreshToken)
    expect(await refusalOf(refresh(idp, first.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
    await expect(refresh(idp, renewed.refreshToken)).resolves.toBeDefined()
  })

  it("revokes every refresh token of a sign-in when a spent one comes again, when told to", async () => {
    // Auth0's reuse detection: the token the first renewal gave renews no more either.
    const idp = await start({ revokeFamilyOnReuse: true })
    const first = await signIn(idp)
    const other = await signIn(idp)
    const renewed = await refresh(idp, first.refreshToken)
    expect(await refusalOf(refresh(idp, first.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
    expect(await refusalOf(refresh(idp, renewed.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
    // Another sign-in's tokens are not of the family.
    await expect(refresh(idp, other.refreshToken)).resolves.toBeDefined()
  })

  it("revokes no other token on a reuse unless told to", async () => {
    const idp = await start({ rotateRefreshTokens: true })
    const first = await signIn(idp)
    const renewed = await refresh(idp, first.refreshToken)
    await refusalOf(refresh(idp, first.refreshToken))
    await expect(refresh(idp, renewed.refreshToken)).resolves.toBeDefined()
  })

  it("gives no refresh token when told to, as a client without offline_access gets none", async () => {
    const idp = await start({ refreshTokens: false })
    const tokens = await signIn(idp)
    expect(tokens.refreshToken).toBeUndefined()
    expect(tokens.refreshExpiresAt).toBeUndefined()
    expect(idp.issued.refresh).toEqual([])
    expect(idp.issued.access).toEqual([tokens.accessToken])
  })

  it("refuses every refresh while told to, as after the session ended at the provider", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    idp.refuseRefresh()
    expect(await refusalOf(refresh(idp, tokens.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
    idp.refuseRefresh(false)
    await expect(refresh(idp, tokens.refreshToken)).resolves.toBeDefined()
  })

  it("refuses a refresh token once it expired, and one of another client", async () => {
    const idp = await start({
      refreshTokenSeconds: 60,
      clients: [
        { id: "pulse-web", secret: "pulse-web-secret" },
        { id: "other", secret: "o" },
      ],
    })
    const tokens = await signIn(idp)
    const metadata = await metadataOf(idp)
    const asOther = requestToken(
      tokenEndpointOf(metadata, { id: "other", secret: "o" }),
      { type: "refresh_token", refreshToken: String(tokens.refreshToken) },
      platform,
    )
    expect(await refusalOf(asOther)).toBe(
      "400 invalid_grant: Token client and authorized client don't match",
    )
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 })
    expect(await refusalOf(refresh(idp, tokens.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
  })
})

describe("the end of a session at the fake provider", () => {
  it("revokes a client's refresh token, which renews no more", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    const endpoint = {
      ...tokenEndpointOf(await metadataOf(idp)),
      url: `${idp.issuer}/protocol/openid-connect/revoke`,
    }
    await revokeToken(
      endpoint,
      { value: String(tokens.refreshToken), hint: "refresh_token" },
      platform,
    )
    expect(idp.revoked).toEqual([tokens.refreshToken])
    expect(await refusalOf(refresh(idp, tokens.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
  })

  it("revokes for an authenticated client only", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    const endpoint = {
      ...tokenEndpointOf(await metadataOf(idp), { id: "pulse-web", secret: "wrong" }),
      url: `${idp.issuer}/protocol/openid-connect/revoke`,
    }
    const revoked = revokeToken(
      endpoint,
      { value: String(tokens.refreshToken), hint: "refresh_token" },
      platform,
    )
    expect(await refusalOf(revoked)).toBe(
      "401 unauthorized_client: Invalid client or Invalid client credentials",
    )
    expect(idp.revoked).toEqual([])
  })

  it("ends the browser's session and returns where the client asked, with its state", async () => {
    const idp = await start()
    const metadata = await metadataOf(idp)
    const { url } = await startSignIn(metadata)
    const chosen = new URL(url)
    chosen.searchParams.set("fake_user", "alice")
    const authorized = await fetch(chosen, { redirect: "manual" })
    const cookie = String(authorized.headers.get("set-cookie")).split(";")[0]
    const sid = cookie.split("=")[1]
    const bob = await signIn(idp, "bob")
    const logoutUrl = endSessionUrl(String(metadata.endSessionEndpoint), {
      clientId: "pulse-web",
      postLogoutRedirectUri: "https://pulse.example.test/app/signed-out",
      state: "s1",
    })
    const ended = await fetch(logoutUrl, { redirect: "manual", headers: { cookie } })
    expect(ended.status).toBe(302)
    expect(ended.headers.get("location")).toBe("https://pulse.example.test/app/signed-out?state=s1")
    expect(ended.headers.get("set-cookie")).toContain(
      "KEYCLOAK_SESSION=; Path=/realms/pulse/; Max-Age=0",
    )
    expect(idp.endedSessions).toEqual([
      {
        clientId: "pulse-web",
        postLogoutRedirectUri: "https://pulse.example.test/app/signed-out",
        sid,
      },
    ])
    await expect(refresh(idp, bob.refreshToken)).resolves.toBeDefined()
  })

  it("ends the session an ID token hint names, and refuses a return the client may not use", async () => {
    const idp = await start({
      clients: [
        {
          id: "pulse-web",
          secret: "pulse-web-secret",
          postLogoutRedirectUris: ["https://pulse.example.test/app/signed-out"],
        },
      ],
    })
    const tokens = await signIn(idp)
    const endpoint = `${idp.issuer}/protocol/openid-connect/logout`
    const refused = await fetch(
      endSessionUrl(endpoint, {
        clientId: "pulse-web",
        postLogoutRedirectUri: "https://evil.example/",
      }),
      { redirect: "manual" },
    )
    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain("Invalid redirect uri")
    const unknown = await fetch(
      endSessionUrl(endpoint, {
        clientId: "other",
        postLogoutRedirectUri: "https://pulse.example.test/app/signed-out",
      }),
      { redirect: "manual" },
    )
    expect(unknown.status).toBe(400)
    const hinted = await fetch(`${endpoint}?id_token_hint=${String(tokens.idToken)}`)
    expect(hinted.status).toBe(200)
    expect(await hinted.text()).toContain("You are signed out.")
    expect(idp.endedSessions.at(-1)).toEqual({
      clientId: undefined,
      postLogoutRedirectUri: undefined,
      sid: decodeJwt(tokens.accessToken).sid,
    })
    expect(await refusalOf(refresh(idp, tokens.refreshToken))).toBe(
      "400 invalid_grant: Token is not active",
    )
  })

  it("takes the end of a session as a form post, and ends none for a hint it cannot read", async () => {
    const idp = await start()
    const tokens = await signIn(idp)
    const posted = await fetch(`${idp.issuer}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: "pulse-web", id_token_hint: "not-a-jwt" }).toString(),
    })
    expect(posted.status).toBe(200)
    expect(idp.endedSessions).toEqual([
      { clientId: "pulse-web", postLogoutRedirectUri: undefined, sid: undefined },
    ])
    await expect(refresh(idp, tokens.refreshToken)).resolves.toBeDefined()
  })
})

describe("the fake provider's edges", () => {
  it("answers a wrong method with 405 and an unknown path with 404", async () => {
    const idp = await start()
    const token = await fetch(`${idp.issuer}/protocol/openid-connect/token`)
    expect(token.status).toBe(405)
    expect(token.headers.get("allow")).toBe("POST")
    expect((await fetch(`${idp.issuer}/protocol/openid-connect/userinfo`)).status).toBe(404)
    expect(
      (await fetch(`${idp.serverUrl}/realms/other/.well-known/openid-configuration`)).status,
    ).toBe(404)
    expect(idp.requests.map(({ endpoint }) => endpoint)).toEqual(["token", "unknown", "unknown"])
  })

  it("refuses a code grant without a PKCE verifier and a grant it does not know", async () => {
    const idp = await start()
    const metadata = await metadataOf(idp)
    const { url } = await startSignIn(metadata)
    const code = String(new URL(await idp.signIn(url)).searchParams.get("code"))
    const post = (form: Record<string, string>) =>
      fetch(metadata.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "pulse-web",
          client_secret: "pulse-web-secret",
          ...form,
        }).toString(),
      }).then(async (response) => [response.status, await response.json()])
    expect(
      await post({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
    ).toEqual([
      400,
      { error: "invalid_grant", error_description: "PKCE code verifier not specified" },
    ])
    expect(await post({ grant_type: "password" })).toEqual([
      400,
      { error: "unsupported_grant_type", error_description: "Unsupported grant_type" },
    ])
  })

  it("lets a code expire after a minute", async () => {
    const idp = await start()
    const metadata = await metadataOf(idp)
    const { url, pkce } = await startSignIn(metadata)
    const code = String(new URL(await idp.signIn(url)).searchParams.get("code"))
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 })
    const exchanged = requestToken(
      tokenEndpointOf(metadata),
      { type: "authorization_code", code, redirectUri: REDIRECT_URI, verifier: pkce.verifier },
      platform,
    )
    expect(await refusalOf(exchanged)).toBe("400 invalid_grant: Code not valid")
  })

  it("puts the authorization request's nonce into the ID token", async () => {
    const idp = await start()
    const metadata = await metadataOf(idp)
    const { url, pkce } = await startSignIn(metadata)
    const withNonce = new URL(url)
    withNonce.searchParams.set("nonce", "n-1")
    const code = String(new URL(await idp.signIn(withNonce.href)).searchParams.get("code"))
    const tokens = await requestToken(
      tokenEndpointOf(metadata),
      { type: "authorization_code", code, redirectUri: REDIRECT_URI, verifier: pkce.verifier },
      platform,
    )
    expect(decodeJwt(String(tokens.idToken)).nonce).toBe("n-1")
    expect(decodeJwt(tokens.accessToken).nonce).toBeUndefined()
  })
})
