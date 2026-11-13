/**
 * The token cache file of a login as @miragon/pulse-http/oauth's TokenStore, so the package
 * renews the login (`refreshingTokens`) on the CLI's files: the format stays the CLI's (schema
 * version 1, cache.ts), the lock is the cache lock, and every reading checks what a first reading
 * checks (the identity, the format), failing with the CLI's LOGIN_REQUIRED. The store keeps the
 * login it read or wrote last, for the provider's preview, user and wording.
 */

import type { TokenRecord, TokenStore } from "@miragon/pulse-http/oauth"
import type { OAuthConfig } from "../../config/types.js"
import { readCache, withCacheLock, writeCache } from "./cache.js"
import { notLoggedIn, otherIdentity, removedWhileRunning } from "./errors.js"
import { receivedAt } from "./expiry.js"
import { sanitize } from "./http.js"
import { identityOf, sameIdentity } from "./identity.js"
import { idTokenClaims } from "./token.js"
import type { CachedLogin, OAuthDeps } from "./types.js"

/** The token cache of one login, as the package reads and writes it. */
export interface LoginStore extends TokenStore {
  /** The login read or written last; undefined before the first reading. */
  readonly current: CachedLogin | undefined
  /** Reads the login as `read` does, for the provider's first reading. */
  load(): Promise<CachedLogin>
}

/** A cached login as the package's token record (the endpoints and the display values stay). */
export function recordOf(login: CachedLogin): TokenRecord {
  return {
    accessToken: login.accessToken,
    receivedAt: receivedAt(login),
    expiresAt: login.expiresAt ?? undefined,
    refreshToken: login.refreshToken ?? undefined,
    refreshExpiresAt: login.refreshExpiresAt ?? undefined,
    scope: login.scope ?? undefined,
    refreshRejected: login.refreshRejected,
  }
}

/** A refusal as the file records it: the sanitized `error: description` the messages show. */
function rejectionOf(record: TokenRecord): CachedLogin["refreshRejected"] {
  const rejected = record.refreshRejected
  if (rejected === undefined) return undefined
  const { at, error, description } = rejected
  const detail = description === undefined || description === "" ? "" : `: ${sanitize(description)}`
  return { at, error: `${sanitize(error)}${detail}` }
}

/**
 * The login after the package wrote `record` over `base`: its tokens and expiries, the display
 * values of a new ID token (else the old ones), a refresh time when the token is new, and a
 * recorded refusal. Endpoints, identity and the login time stay.
 */
function mergedLogin(base: CachedLogin, record: TokenRecord): CachedLogin {
  const claims = idTokenClaims(record.idToken)
  const renewed = record.receivedAt !== receivedAt(base)
  const refreshRejected = rejectionOf(record)
  return {
    version: 1,
    identity: base.identity,
    endpoints: base.endpoints,
    tokenType: "Bearer",
    accessToken: record.accessToken,
    expiresAt: record.expiresAt ?? null,
    refreshToken: record.refreshToken ?? null,
    refreshExpiresAt: record.refreshExpiresAt ?? null,
    scope: record.scope ?? null,
    subject: claims.subject ?? base.subject,
    user: claims.user ?? base.user,
    loggedInAt: base.loggedInAt,
    refreshedAt: renewed ? record.receivedAt : base.refreshedAt,
    ...(refreshRejected === undefined ? {} : { refreshRejected }),
  }
}

/** The store of the login cached at `path` for `config`. */
export function loginStore(path: string, config: OAuthConfig, deps: OAuthDeps): LoginStore {
  let current: CachedLogin | undefined
  const load = async (): Promise<CachedLogin> => {
    const login = await readCache(path, deps, config)
    if (login === undefined) {
      throw current === undefined ? notLoggedIn(config) : removedWhileRunning(config)
    }
    if (!sameIdentity(login.identity, identityOf(config))) {
      throw otherIdentity(login.identity, config)
    }
    current = login
    return login
  }
  return {
    get current() {
      return current
    },
    load,
    read: async () => recordOf(await load()),
    async write(_key, record) {
      // The package writes only what it read under the lock, so `current` is that login.
      const base = current ?? (await load())
      const next = mergedLogin(base, record)
      await writeCache(path, next, deps)
      current = next
    },
    exclusive: (_key, work) => withCacheLock(path, deps, work),
  }
}
