/**
 * OAuth fixtures for unit tests: resolved configurations, the dependencies of the OAuth modules
 * (and of every auth provider) on a fake runtime, cached logins and the paths of the token cache.
 */

import { createHash } from "node:crypto"
import type { AuthDeps } from "../../src/auth/index.js"
import type { CachedLogin, LoginDeps, OAuthDeps } from "../../src/auth/oauth/types.js"
import type { LoginKey, OAuthConfig } from "../../src/config/types.js"
import type { TraceEvent } from "../../src/http/types.js"
import { ISSUER } from "./fake-idp.js"
import { CONFIG_PATH, type FakeRuntime } from "./fake-runtime.js"

/** The token directory of the fake runtime's home on Linux. */
export const TOKEN_DIR = "/home/tester/.config/operate/tokens"

/** The origin of the profiles of the fake runtime's config file. */
const CONFIG_ORIGIN = `config:${CONFIG_PATH}`

/** The login key of profile p of `oauthProfiles()` in the config file; overrides change it. */
export function loginKey(overrides: Partial<LoginKey> = {}): LoginKey {
  const { origin = CONFIG_ORIGIN, profile, ...settings } = overrides
  // the key order of the CLI: the file name hashes the JSON
  return {
    origin,
    ...(profile === undefined ? {} : { profile }),
    issuer: ISSUER,
    tokenEndpoint: null,
    clientId: "operate-cli",
    audience: null,
    scopes: ["offline_access", "openid"],
    ...settings,
  }
}

/** The cache file of a login key (`login-<first 32 hex chars of SHA-256(key JSON)>.json`). */
export function loginFile(key: LoginKey = loginKey()): string {
  const digest = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 32)
  return `${TOKEN_DIR}/login-${digest}.json`
}

/** The cache file of profile p of `oauthProfiles()`. */
export const TOKEN_FILE = loginFile()
export const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`
export const REVOCATION_ENDPOINT = `${ISSUER}/protocol/openid-connect/revoke`

/** Changes of the default configuration; undefined removes a property. */
export type OAuthOverrides = { readonly [K in keyof OAuthConfig]?: OAuthConfig[K] | undefined }

/**
 * The resolved settings of profile p of `oauthProfiles()`; without a profile (`profile:
 * undefined`) also without its login key, like the configuration from the environment.
 */
export function oauthConfig(overrides: OAuthOverrides = {}): OAuthConfig {
  const noProfile = "profile" in overrides && overrides.profile === undefined
  const merged = {
    type: "oauth",
    issuer: ISSUER,
    clientId: "operate-cli",
    scopes: ["openid", "offline_access"],
    redirectPort: 0,
    profile: "p",
    login: noProfile ? undefined : loginKey(),
    sources: {
      endpoints: "profile",
      clientId: "profile",
      scopes: "default",
      redirectPort: "default",
    },
    ...overrides,
  }
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as OAuthConfig
}

export function oauthDeps(
  runtime: FakeRuntime,
  overrides: Partial<OAuthDeps> & { readonly events?: TraceEvent[] } = {},
): OAuthDeps {
  const { events, ...rest } = overrides
  return {
    fetch: runtime.fetch,
    fs: runtime.fs,
    now: () => runtime.now(),
    withLock: (path, holdMs, action) => runtime.withLock(path, holdMs, action),
    tokenDir: TOKEN_DIR,
    tokenPath: (fileName) => `${TOKEN_DIR}/${fileName}`,
    timeoutMs: 30_000,
    ...(events === undefined ? {} : { trace: (event: TraceEvent) => events.push(event) }),
    ...rest,
  }
}

/**
 * `oauthDeps` plus the fake shell and the scope of the token cache (the working directory): what
 * every auth provider gets.
 */
export function authDeps(
  runtime: FakeRuntime,
  overrides: Partial<AuthDeps> & { readonly events?: TraceEvent[] } = {},
): AuthDeps {
  return {
    runCommand: (command, options) => runtime.runCommand(command, options),
    scope: runtime.cwd,
    ...oauthDeps(runtime, overrides),
  }
}

export function loginDeps(runtime: FakeRuntime, overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    ...oauthDeps(runtime),
    randomBytes: (length) => runtime.randomBytes(length),
    listenLoopback: (port, handler) => runtime.listenLoopback(port, handler),
    openBrowser: (url) => runtime.openBrowser(url),
    deadline: (ms) => runtime.deadline(ms),
    stderr: runtime.stderr,
    ...overrides,
  }
}

/** A cached login of `operate-cli` for profile p, received at `now` with a 300 s token. */
export function cachedLogin(now: number, overrides: Partial<CachedLogin> = {}): CachedLogin {
  return {
    version: 1,
    identity: {
      issuer: ISSUER,
      tokenEndpoint: null,
      clientId: "operate-cli",
      audience: null,
      scopes: ["offline_access", "openid"],
    },
    endpoints: { token: TOKEN_ENDPOINT, revocation: REVOCATION_ENDPOINT, clientAuthMethod: "none" },
    tokenType: "Bearer",
    accessToken: "cached-access",
    expiresAt: now + 300_000,
    refreshToken: "cached-refresh",
    refreshExpiresAt: now + 1_800_000,
    scope: "openid offline_access",
    subject: "user-1",
    user: "alice",
    loggedInAt: now,
    refreshedAt: null,
    ...overrides,
  }
}

/** The file content of a cached login, as operate writes it. */
export function cacheText(login: CachedLogin): string {
  return `${JSON.stringify(login, null, 2)}\n`
}

/** A config file whose default profile p uses OAuth (public client `operate-cli`). */
export function oauthProfiles(auth: Readonly<Record<string, unknown>> = {}, profile = {}): string {
  return JSON.stringify({
    defaultProfile: "p",
    profiles: {
      p: { auth: { type: "oauth", issuer: ISSUER, clientId: "operate-cli", ...auth }, ...profile },
    },
  })
}
