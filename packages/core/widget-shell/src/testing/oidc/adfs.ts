/**
 * The fake identity provider as ADFS 2019 and later plays it (`flavor: "adfs"`), from Microsoft's
 * documentation and live farms' discovery documents: its issuer `<serverUrl>/adfs` and the paths
 * under it; a discovery that names `access_token_issuer` (MS-OIDCE) and no PKCE methods, no
 * revocation endpoint and no `iss` in the authorization response; access tokens of that issuer for
 * the one resource a request names (a request without one gets `urn:microsoft:userinfo`, an
 * identifier that is no URI `microsoft:identityserver:<identifier>`, as a live farm's do), with
 * `scp`, `appid` and `ver` 1.0 and no caller unless the Web API's issuance transform rule names one
 * (the option `callerClaim`, emitted with the user's `upn`); ID tokens whose `sub` is a hash of the
 * client and the user; the refresh token's lifetime as `refresh_token_expires_in`; and refresh
 * tokens that never rotate, are not renewed with a refresh, and renew after the session ended at
 * the end-session endpoint (the ADFS FAQ).
 */
import { createHash } from "node:crypto"
import { newRefreshToken, sign, type IssuedSession, type Realm } from "./realm.js"

/** ADFS's paths below its issuer (`/adfs`): no revocation endpoint. */
export const ADFS_PATHS = {
  discovery: "/.well-known/openid-configuration",
  jwks: "/discovery/keys",
  authorize: "/oauth2/authorize/",
  token: "/oauth2/token/",
  logout: "/oauth2/logout",
} as const

/** The audience of an ADFS token whose request named no resource. */
const USERINFO_AUDIENCE = "urn:microsoft:userinfo"

/** The audience of an ADFS token for `resource`: an identifier that is no URI behind ADFS's prefix. */
const audienceOf = (resource: string | undefined): string => {
  if (resource === undefined) return USERINFO_AUDIENCE
  return URL.canParse(resource) ? resource : `microsoft:identityserver:${resource}`
}

/** ADFS's discovery document, as a farm of 2019 and later publishes it. */
export function adfsDiscovery(realm: Realm): Record<string, unknown> {
  const url = (path: string) => `${realm.issuer}${path}`
  return {
    issuer: realm.issuer,
    authorization_endpoint: url(ADFS_PATHS.authorize),
    token_endpoint: url(ADFS_PATHS.token),
    jwks_uri: url(ADFS_PATHS.jwks),
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "private_key_jwt",
      "windows_client_authentication",
    ],
    response_types_supported: ["code", "id_token", "code id_token"],
    response_modes_supported: ["query", "fragment", "form_post"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    subject_types_supported: ["pairwise"],
    scopes_supported: ["openid", "allatclaims", "user_impersonation", "aza", "logon_cert"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    access_token_issuer: realm.accessTokenIssuer,
    microsoft_multi_refresh_token: true,
    userinfo_endpoint: url("/userinfo"),
    end_session_endpoint: url(ADFS_PATHS.logout),
    frontchannel_logout_supported: true,
    frontchannel_logout_session_supported: true,
  }
}

const seconds = (ms: number): number => Math.floor(ms / 1000)

/** The claims the Web API's issuance transform rule emits: the caller claim and the `upn`. */
function ruleClaims(realm: Realm, session: IssuedSession): Record<string, string> {
  const { callerClaim } = realm
  if (callerClaim === undefined) return {}
  const { user } = session
  return { [callerClaim]: user.sub, ...(user.email === undefined ? {} : { upn: user.email }) }
}

/** An ID token's `sub`: a hash of the client and the user, so each client sees another. */
const pairwise = (clientId: string, sub: string): string =>
  createHash("sha256").update(`${clientId}:${sub}`).digest("base64")

async function idTokenOf(realm: Realm, session: IssuedSession): Promise<string | undefined> {
  const { clientId, scope, user, sid, nonce } = session
  if (!scope.split(" ").includes("openid")) return undefined
  const idToken = await sign(
    realm,
    {
      sub: pairwise(clientId, user.sub),
      aud: clientId,
      auth_time: seconds(Date.now()),
      sid,
      unique_name: `PULSE\\${user.username}`,
      ...(user.email === undefined ? {} : { upn: user.email }),
      ...(nonce ? { nonce } : {}),
      apptype: "Confidential",
      appid: clientId,
      ver: "1.0",
    },
    realm.accessTokenSeconds,
  )
  realm.issued.id.push(idToken)
  return idToken
}

/**
 * A sign-in's or a refresh's tokens, as ADFS's token endpoint answers them: the access token for
 * `resource`, a refresh token at the sign-in only, and an ID token where `openid` was asked for.
 */
export async function issueAdfsTokens(
  realm: Realm,
  session: IssuedSession,
  resource: string | undefined,
  renewal: boolean,
): Promise<Record<string, unknown>> {
  const { clientId, scope } = session
  const accessToken = await sign(
    realm,
    {
      aud: audienceOf(resource),
      apptype: "Confidential",
      appid: clientId,
      authmethod: "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
      auth_time: new Date().toISOString(),
      ver: "1.0",
      scp: scope,
      ...ruleClaims(realm, session),
    },
    realm.accessTokenSeconds,
    realm.accessTokenIssuer,
  )
  realm.issued.access.push(accessToken)
  const refresh =
    renewal || !realm.refreshTokens
      ? {}
      : {
          refresh_token: newRefreshToken(realm, session),
          refresh_token_expires_in: realm.refreshTokenSeconds,
        }
  const idToken = await idTokenOf(realm, session)
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: realm.accessTokenSeconds,
    ...refresh,
    scope,
    ...(idToken === undefined ? {} : { id_token: idToken }),
  }
}
