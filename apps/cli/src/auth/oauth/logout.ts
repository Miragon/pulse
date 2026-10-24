/**
 * `pulse-cli auth logout`: under the cache lock, revoke the refresh token (else the
 * access token) at the revocation endpoint cached at login (RFC 7009) and remove the cache file.
 * A failed or skipped revocation only warns: the file is removed anyway. Works when the
 * profile's OAuth settings no longer resolve. A client secret is a credential for one
 * authorization server and client (RFC 6749 §2.3.1): it is sent only for a confidential login
 * whose identity equals the resolved settings, never taken from other settings.
 */

import type { OAuthConfig } from "../../config/types.js"
import { clientAuthOf, readCache, removeCache, withCacheLock } from "./cache.js"
import { iso, owner } from "./errors.js"
import { isExpired } from "./expiry.js"
import { shownUrl } from "./http.js"
import { identityOf, sameIdentity } from "./identity.js"
import { revokeToken, type TokenClient } from "./token.js"
import type { CachedLogin, OAuthDeps } from "./types.js"

export interface LogoutResult {
  readonly removed: boolean
  /** null: nothing to revoke or no revocation endpoint. */
  readonly revoked: boolean | null
  /** Warnings for stderr (failed, skipped or impossible revocation). */
  readonly warnings: readonly string[]
  /** Present when the removed login had an access token that had not expired (null: unknown). */
  readonly validUntil?: number | null
}

/** What logout works on: whose login it is and the current settings, as far as they resolve. */
export interface LogoutTarget {
  readonly profile: string | undefined
  /** Where the issuer was configured, for the hints of network errors. */
  readonly source: string
  /** The resolved OAuth settings; absent when they do not resolve or OAuth is not selected. */
  readonly settings?: OAuthConfig | undefined
  /** Why there are no resolved OAuth settings (shown when a client secret would be needed). */
  readonly unresolved?: string | undefined
}

interface Revocation {
  readonly revoked: boolean | null
  readonly warnings: readonly string[]
}

/** `stays valid until <ISO>` of a token, or `until it expires` when the expiry is unknown. */
function validity(expiresAt: number | null): string {
  return expiresAt === null ? "until it expires" : `until ${iso(expiresAt)}`
}

/** No revocation endpoint (explicit endpoints, or none in the discovery document). */
function noEndpoint(login: CachedLogin): Revocation {
  if (login.refreshToken === null) return { revoked: null, warnings: [] }
  const { token } = login.endpoints
  const server = login.identity.issuer ?? (URL.canParse(token) ? new URL(token).origin : token)
  return {
    revoked: null,
    warnings: [
      `Warning: pulse-cli knows no token revocation endpoint (RFC 7009) for ${server} (explicit endpoints, or none in its discovery document); the refresh token was not revoked and stays valid ${validity(login.refreshExpiresAt)}. End the session at the authorization server if needed (sign out, or revoke the user's sessions).`,
    ],
  }
}

/**
 * The client secret for revoking `login`: none for a public login; for a confidential one the
 * secret of the resolved settings, only when they have the login's identity. Else why not.
 */
function secretFor(
  login: CachedLogin,
  target: LogoutTarget,
): { readonly secret?: string } | { readonly skip: string } {
  if (login.endpoints.clientAuthMethod === "none") return {}
  const { settings } = target
  if (settings === undefined) {
    return { skip: target.unresolved ?? `${owner(target.profile)} no longer uses OAuth` }
  }
  if (!sameIdentity(login.identity, identityOf(settings))) {
    return {
      skip: `the login was made for another issuer, client, audience or scopes than the settings of ${owner(target.profile)}`,
    }
  }
  return settings.clientSecret === undefined
    ? { skip: `the settings of ${owner(target.profile)} have no client secret` }
    : { secret: settings.clientSecret }
}

async function revoke(login: CachedLogin, target: LogoutTarget, deps: OAuthDeps) {
  const endpoint = login.endpoints.revocation
  if (endpoint === null) return noEndpoint(login)
  const kind = login.refreshToken === null ? "access" : "refresh"
  const credential = secretFor(login, target)
  if ("skip" in credential) {
    return {
      revoked: false,
      warnings: [
        `Warning: the client secret of the login is not available (${credential.skip}); the ${kind} token was not revoked and stays valid until it expires.`,
      ],
    }
  }
  const client: TokenClient = {
    clientId: login.identity.clientId,
    clientSecret: credential.secret,
    method: clientAuthOf(login),
    endpoint: { url: endpoint, source: target.source },
    who: { profile: target.profile },
  }
  const token = { value: login.refreshToken ?? login.accessToken, hint: `${kind}_token` } as const
  const reason = await revokeToken(client, token, deps)
  if (reason === undefined) return { revoked: true, warnings: [] }
  return {
    revoked: false,
    warnings: [
      `Warning: could not revoke the ${kind} token at ${shownUrl(endpoint)} (${reason}); it stays valid until it expires.`,
    ],
  }
}

/** The login of the file; an unreadable one counts as none (the file is removed anyway). */
async function storedLogin(path: string, deps: OAuthDeps, profile: string | undefined) {
  try {
    return await readCache(path, deps, { profile })
  } catch {
    return undefined
  }
}

/** Revokes and removes the cached login at `path`. */
export async function logout(
  path: string,
  target: LogoutTarget,
  deps: OAuthDeps,
): Promise<LogoutResult> {
  if (!(await deps.fs.exists(path))) return { removed: false, revoked: null, warnings: [] }
  return withCacheLock(path, deps, async () => {
    const login = await storedLogin(path, deps, target.profile)
    const revocation: Revocation =
      login === undefined ? { revoked: null, warnings: [] } : await revoke(login, target, deps)
    const removed = await removeCache(path, deps)
    const valid = login !== undefined && !isExpired(deps.now(), login.expiresAt)
    return { removed, ...revocation, ...(valid ? { validUntil: login.expiresAt } : {}) }
  })
}
