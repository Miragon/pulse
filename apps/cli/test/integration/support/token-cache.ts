/**
 * The CLI's OAuth token cache (design §16.5), read and rewritten by the tests: they move expiry
 * times or replace tokens to reach refresh paths deterministically, and they collect every token
 * the CLI ever stored to prove that no output contains one.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface LoginIdentity {
  readonly issuer: string | null;
  readonly tokenEndpoint: string | null;
  readonly clientId: string;
  readonly audience: string | null;
  /** Sorted, deduplicated requested scopes. */
  readonly scopes: readonly string[];
}

/** File format version 1 of `tokens/login-<hash>.json` and `tokens/env-<hash>.json`. */
export interface CachedLogin {
  readonly version: 1;
  readonly identity: LoginIdentity;
  readonly endpoints: {
    readonly token: string;
    readonly revocation: string | null;
    /** `none` for a public client, else the client authentication method of the login. */
    readonly clientAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post';
  };
  readonly tokenType: string;
  readonly accessToken: string;
  /** Epoch ms or null (unknown). */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  readonly refreshExpiresAt: number | null;
  readonly scope: string | null;
  readonly subject: string | null;
  readonly user: string | null;
  readonly loggedInAt: number;
  readonly refreshedAt: number | null;
  /** Written when the authorization server refused the refresh token. */
  readonly refreshRejected?: { readonly at: number; readonly error: string };
}

/** `<config home>/operate/tokens` (XDG_CONFIG_HOME; APPDATA on Windows). */
export function tokenDirectory(configHome: string): string {
  return join(configHome, 'operate', 'tokens');
}

/**
 * What makes profiles share a login (design §16.5): where the profile comes from (`config:<path>`
 * for a config file) and the OAuth settings it stores.
 */
export interface LoginKey {
  readonly origin: string;
  readonly issuer: string | null;
  readonly tokenEndpoint: string | null;
  readonly clientId: string | null;
  readonly audience: string | null;
  readonly scopes: readonly string[];
}

function text(auth: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = auth[key];
  return typeof value === 'string' ? value : null;
}

/** The login key of a profile of the config file `configFile` with the stored settings `auth`. */
export function loginKeyOf(configFile: string, auth: Readonly<Record<string, unknown>>): LoginKey {
  const scopes = Array.isArray(auth.scopes)
    ? (auth.scopes as string[])
    : ['openid', 'offline_access'];
  return {
    origin: `config:${configFile}`,
    issuer: text(auth, 'issuer'),
    tokenEndpoint:
      text(auth, 'authorizationEndpoint') === null ? null : text(auth, 'tokenEndpoint'),
    clientId: text(auth, 'clientId'),
    audience: text(auth, 'audience'),
    scopes: [...new Set(scopes)].sort(),
  };
}

/** Path of the cache file of a login: the first 32 hex characters of SHA-256 of the key JSON. */
export function loginCacheFile(configHome: string, key: LoginKey): string {
  const hash = createHash('sha256').update(JSON.stringify(key)).digest('hex');
  return join(tokenDirectory(configHome), `login-${hash.slice(0, 32)}.json`);
}

/**
 * File name of the cache of a login without a profile: the first 32 hex characters of the SHA-256
 * of the identity in schema key order.
 */
export function envCacheFileName(identity: LoginIdentity): string {
  const ordered: LoginIdentity = {
    issuer: identity.issuer,
    tokenEndpoint: identity.tokenEndpoint,
    clientId: identity.clientId,
    audience: identity.audience,
    scopes: [...new Set(identity.scopes)].sort(),
  };
  const hash = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
  return `env-${hash.slice(0, 32)}.json`;
}

export async function readCache(file: string): Promise<CachedLogin> {
  return JSON.parse(await readFile(file, 'utf8')) as CachedLogin;
}

/**
 * Rewrites the cache file with `patch` applied, in the CLI's format. The file keeps its mode (it
 * exists already); call it only while no CLI process runs.
 */
export async function writeCache(
  file: string,
  patch: Partial<Omit<CachedLogin, 'version'>>,
): Promise<CachedLogin> {
  const value: CachedLogin = { ...(await readCache(file)), ...patch };
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return value;
}

/** Cache files only: no lock files, no temporary files of the atomic writer. */
const CACHE_FILE = /^(?:login|env)-.+\.json$/;

async function readIfPresent(file: string): Promise<CachedLogin | undefined> {
  try {
    return await readCache(file);
  } catch {
    // removed meanwhile (logout) or not written by the CLI
    return undefined;
  }
}

export interface StoredTokens {
  readonly accessTokens: readonly string[];
  readonly refreshTokens: readonly string[];
}

/** Every access and refresh token in the cache files of the directory right now. */
export async function storedTokens(directory: string): Promise<StoredTokens> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const logins = await Promise.all(
    names
      .filter((name) => CACHE_FILE.test(name))
      .map((name) => readIfPresent(join(directory, name))),
  );
  const present = logins.filter((login) => login !== undefined);
  return {
    accessTokens: present.map((login) => login.accessToken),
    refreshTokens: present.flatMap((login) =>
      login.refreshToken === null ? [] : [login.refreshToken],
    ),
  };
}
