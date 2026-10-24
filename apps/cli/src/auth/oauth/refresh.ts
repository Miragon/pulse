/**
 * A refresh under the cache lock (design §16.6 steps 1–5). Under the lock the file is the only
 * source of the refresh token: another process may have rotated it since this one read the
 * cache, and sending the old one again is a replay that ends the session (Keycloak reuse
 * detection). A newer access token in the file is adopted without a request, so concurrent
 * commands send one refresh token exactly once.
 */

import { endpointSource } from '../../config/resolve-oauth.js';
import type { OAuthConfig } from '../../config/types.js';
import { clientAuthOf, readCache, withCacheLock, writeCache } from './cache.js';
import { cannotRefresh, otherIdentity, removedWhileRunning } from './errors.js';
import { canRefresh, expiryOf, isExpired } from './expiry.js';
import { identityOf, sameIdentity } from './identity.js';
import { refreshRejection, refreshTokens, type TokenClient } from './token.js';
import type { CachedLogin, OAuthDeps, TokenResponse } from './types.js';

/** The token endpoint client of a cached login (refreshes need no discovery). */
function cachedClient(config: OAuthConfig, login: CachedLogin): TokenClient {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    method: clientAuthOf(login),
    endpoint: { url: login.endpoints.token, source: endpointSource(config) },
    who: config,
  };
}

/** `refresh_expires_in` given: its expiry; else none after a rotation, else unchanged. */
function refreshExpiry(stored: CachedLogin, tokens: TokenResponse, now: number): number | null {
  if (tokens.refreshExpiresIn !== null) return expiryOf(now, tokens.refreshExpiresIn);
  return tokens.refreshToken === null ? stored.refreshExpiresAt : null;
}

/**
 * The login after a refresh: the new access token; the new refresh token when the server rotated
 * it (the old one is discarded, RFC 6749 §6), else the old one; display values when present.
 */
function mergeRefresh(stored: CachedLogin, tokens: TokenResponse, now: number): CachedLogin {
  return {
    ...stored,
    tokenType: 'Bearer',
    accessToken: tokens.accessToken,
    expiresAt: expiryOf(now, tokens.expiresIn),
    refreshToken: tokens.refreshToken ?? stored.refreshToken,
    refreshExpiresAt: refreshExpiry(stored, tokens, now),
    scope: tokens.scope ?? stored.scope,
    subject: tokens.subject ?? stored.subject,
    user: tokens.user ?? stored.user,
    refreshedAt: now,
  };
}

/** Re-reads the file under the lock with the checks of a first read; a missing file fails. */
async function storedLogin(config: OAuthConfig, path: string, deps: OAuthDeps) {
  const stored = await readCache(path, deps, config);
  if (stored === undefined) throw removedWhileRunning(config);
  if (!sameIdentity(stored.identity, identityOf(config)))
    throw otherIdentity(stored.identity, config);
  return stored;
}

/**
 * Refreshes the login whose access token is `current`, holding the cache lock: adopts a newer
 * unexpired token of the file, else refreshes with the file's refresh token and writes the
 * result. `invalid_grant` leaves the file unchanged.
 */
export function refreshUnderLock(
  config: OAuthConfig,
  path: string,
  current: CachedLogin,
  deps: OAuthDeps,
): Promise<CachedLogin> {
  return withCacheLock(path, deps, async () => {
    const stored = await storedLogin(config, path, deps);
    const now = deps.now();
    if (stored.accessToken !== current.accessToken && !isExpired(now, stored.expiresAt)) {
      return stored;
    }
    const tokens = await refreshOrRecord(config, path, stored, deps);
    const refreshed = mergeRefresh(stored, tokens, deps.now());
    await writeCache(path, refreshed, deps);
    return refreshed;
  });
}

/**
 * The refresh request with the file's refresh token; a refusal of the refresh token (LOGIN_REQUIRED, e.g. `invalid_grant`) is
 * recorded in the file, tokens unchanged, so `auth status` and later commands know that a new
 * login is needed without asking the authorization server again. Call it holding the lock.
 */
async function refreshOrRecord(
  config: OAuthConfig,
  path: string,
  stored: CachedLogin,
  deps: OAuthDeps,
): Promise<TokenResponse> {
  const now = deps.now();
  if (stored.refreshToken === null || !canRefresh(stored, now)) {
    throw cannotRefresh(stored, now, config);
  }
  try {
    return await refreshTokens(cachedClient(config, stored), stored.refreshToken, deps);
  } catch (error) {
    const rejection = refreshRejection(error);
    if (rejection !== undefined) {
      const refreshRejected = { at: deps.now(), error: rejection };
      // best effort: the refusal itself is what the command reports
      await writeCache(path, { ...stored, refreshRejected }, deps).catch(() => undefined);
    }
    throw error;
  }
}
