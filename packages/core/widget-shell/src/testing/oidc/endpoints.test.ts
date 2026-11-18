import { describe, expect, it } from "vitest"
import { endGrant, token } from "./endpoints.js"
import {
  createRealm,
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  newRefreshToken,
  type FakeOidcOptions,
  type Realm,
} from "./realm.js"

/** The token endpoint's refresh grant in-process: it runs at once up to its first wait. */
const refreshIn = (realm: Realm, refreshToken: string) =>
  token(realm, {
    endpoint: "token",
    method: "POST",
    path: "/realms/test/protocol/openid-connect/token",
    query: new URLSearchParams(),
    form: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: FAKE_OIDC_CLIENT.id,
      client_secret: String(FAKE_OIDC_CLIENT.secret),
    }),
    headers: {},
  })

/** How a sign-in's grant ends while a renewal of it is under way. */
type Ending = (realm: Realm, renewing: { refreshToken: string; sid: string }) => unknown

const ENDINGS: readonly (readonly [string, FakeOidcOptions, Ending])[] = [
  [
    "a reuse of the refresh token it spent",
    { revokeFamilyOnReuse: true },
    (realm, { refreshToken }) => refreshIn(realm, refreshToken),
  ],
  ["the end of the grant at the provider", {}, (realm, { sid }) => endGrant(realm, sid)],
]

describe("a sign-in's grant that ends while a renewal of it is being answered", () => {
  // The renewal spends its refresh token at once and mints the new one once its access token is
  // signed: an end in between, which two replicas' parallel renewals over sockets meet now and
  // then, reaches the new one too, as a real provider checks a refresh token's sign-in at its use.
  it.each(ENDINGS)("refuses the refresh token it mints after %s", async (_case, options, end) => {
    const realm = await createRealm("http://127.0.0.1/realms/test", options)
    const sid = "renewing-sign-in"
    const session = { clientId: FAKE_OIDC_CLIENT.id, scope: "openid", user: FAKE_OIDC_USERS[0] }
    const refreshToken = newRefreshToken(realm, { ...session, sid })
    const renewal = refreshIn(realm, refreshToken)
    await end(realm, { refreshToken, sid })
    const renewed = await renewal
    expect(renewed.status).toBe(200)
    const minted = (JSON.parse(String(renewed.body)) as { refresh_token: string }).refresh_token
    expect(realm.issued.refresh).toEqual([refreshToken, minted])
    expect(JSON.parse(String((await refreshIn(realm, minted)).body))).toEqual({
      error: "invalid_grant",
      error_description: "Token is not active",
    })
  })
})
