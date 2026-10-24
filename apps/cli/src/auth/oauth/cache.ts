/**
 * The token cache: one JSON file per login in the token directory, written
 * atomically with mode 0600 under a lock file; readers need no lock. Profiles with the same login
 * key (their origin and stored OAuth settings, `LoginKey`) share one file (`login-<hash>.json`),
 * the configuration from the environment has one per identity (`env-<hash>.json`). A cache whose
 * identity (issuer, explicit token endpoint, client, audience, scopes) differs from the
 * configuration counts as not logged in. Messages never quote the file content.
 */

import { configError } from "../../config/config-error.js"
import type { LoginKey, OAuthConfig } from "../../config/types.js"
import { OperateError } from "../../errors.js"
import { isRecord } from "../../util.js"
import { type LoginOwner, unknownFormat } from "./errors.js"
import { identityOf } from "./identity.js"
import { sha256 } from "./pkce.js"
import type { CachedLogin, ClientAuthMethod, LoginIdentity, OAuthDeps } from "./types.js"

/** How much longer than one token request a lock holder may keep the lock. */
const LOCK_GRACE_MS = 10_000

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The first 32 hex characters of SHA-256 of the JSON of `value`. */
async function digestOf(value: unknown): Promise<string> {
  return hex(await sha256(JSON.stringify(value))).slice(0, 32)
}

/** `login-<digest of the key>.json`: the cache file of the profiles with this login key. */
export async function loginFileName(key: LoginKey): Promise<string> {
  return `login-${await digestOf(key)}.json`
}

/** The login file of a profile (`loginFileName`), else `env-<digest of the identity>.json`. */
export async function cacheFileName(config: OAuthConfig): Promise<string> {
  if (config.login !== undefined) return loginFileName(config.login)
  return `env-${await digestOf(identityOf(config))}.json`
}

/**
 * The client authentication of refreshes and revocations: the method of the login; a public
 * login that now has a client secret (same identity) uses client_secret_basic.
 */
export function clientAuthOf(login: CachedLogin): ClientAuthMethod {
  return login.endpoints.clientAuthMethod === "client_secret_post"
    ? "client_secret_post"
    : "client_secret_basic"
}

/** The absolute path of the cache file of a configuration. */
export async function cachePath(
  config: OAuthConfig,
  deps: Pick<OAuthDeps, "tokenPath">,
): Promise<string> {
  return deps.tokenPath(await cacheFileName(config))
}

type Check = (value: unknown) => boolean

const isString: Check = (value) => typeof value === "string"
const isNumber: Check = (value) => typeof value === "number" && Number.isFinite(value)
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value)

function matches(value: unknown, checks: Readonly<Record<string, Check>>): boolean {
  return isRecord(value) && Object.entries(checks).every(([key, check]) => check(value[key]))
}

const IDENTITY: Readonly<Record<keyof LoginIdentity, Check>> = {
  issuer: orNull(isString),
  tokenEndpoint: orNull(isString),
  clientId: isString,
  audience: orNull(isString),
  scopes: (value) => Array.isArray(value) && value.every(isString),
}

const CLIENT_AUTH: readonly unknown[] = ["none", "client_secret_basic", "client_secret_post"]

const ENDPOINTS: Readonly<Record<keyof CachedLogin["endpoints"], Check>> = {
  token: isString,
  revocation: orNull(isString),
  clientAuthMethod: (value) => CLIENT_AUTH.includes(value),
}

const REJECTION: Readonly<Record<"at" | "error", Check>> = { at: isNumber, error: isString }

const LOGIN: Readonly<Record<keyof CachedLogin, Check>> = {
  version: (value) => value === 1,
  identity: (value) => matches(value, IDENTITY),
  endpoints: (value) => matches(value, ENDPOINTS),
  tokenType: isString,
  accessToken: (value) => typeof value === "string" && value !== "",
  expiresAt: orNull(isNumber),
  refreshToken: orNull((value) => typeof value === "string" && value !== ""),
  refreshExpiresAt: orNull(isNumber),
  scope: orNull(isString),
  subject: orNull(isString),
  user: orNull(isString),
  loggedInAt: isNumber,
  refreshedAt: orNull(isNumber),
  refreshRejected: (value) => value === undefined || matches(value, REJECTION),
}

function parseCache(text: string): CachedLogin | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return matches(value, LOGIN) ? (value as CachedLogin) : undefined
  } catch {
    return undefined
  }
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined
  if (typeof code === "string") return code
  return error instanceof Error ? error.message : String(error)
}

/**
 * The cached login, or undefined when there is none. An unparsable file is LOGIN_REQUIRED (the
 * next login replaces it), an I/O error CONFIG.
 */
export async function readCache(
  path: string,
  deps: Pick<OAuthDeps, "fs">,
  who: LoginOwner,
): Promise<CachedLogin | undefined> {
  let data: Uint8Array
  try {
    if (!(await deps.fs.exists(path))) return undefined
    data = await deps.fs.readFile(path)
  } catch (error) {
    throw configError(
      `Cannot read token cache ${path} (${reasonOf(error)})`,
      "Check the permissions of the token directory and file.",
    )
  }
  const login = parseCache(new TextDecoder().decode(data))
  if (login === undefined) throw unknownFormat(path, who)
  return login
}

/** The file content: the keys in schema order, indented with 2 spaces, a final newline. */
export function serializeCache(login: CachedLogin): string {
  const value: CachedLogin = {
    version: 1,
    identity: { ...login.identity },
    endpoints: {
      token: login.endpoints.token,
      revocation: login.endpoints.revocation,
      clientAuthMethod: login.endpoints.clientAuthMethod,
    },
    tokenType: login.tokenType,
    accessToken: login.accessToken,
    expiresAt: login.expiresAt,
    refreshToken: login.refreshToken,
    refreshExpiresAt: login.refreshExpiresAt,
    scope: login.scope,
    subject: login.subject,
    user: login.user,
    loggedInAt: login.loggedInAt,
    refreshedAt: login.refreshedAt,
    ...(login.refreshRejected === undefined
      ? {}
      : { refreshRejected: { at: login.refreshRejected.at, error: login.refreshRejected.error } }),
  }
  return `${JSON.stringify(value, null, 2)}\n`
}

function writeError(path: string, error: unknown): OperateError {
  return configError(
    `Cannot write token cache ${path} (${reasonOf(error)})`,
    "Check the permissions of the token directory.",
  )
}

/** Writes the cache file with mode 0600 (atomically); call it holding the lock. */
export async function writeCache(path: string, login: CachedLogin, deps: Pick<OAuthDeps, "fs">) {
  try {
    await deps.fs.writeFile(path, serializeCache(login), { mode: 0o600 })
  } catch (error) {
    throw writeError(path, error)
  }
}

/** Removes the cache file; resolves false when there was none. Call it holding the lock. */
export async function removeCache(path: string, deps: Pick<OAuthDeps, "fs">): Promise<boolean> {
  try {
    return await deps.fs.remove(path)
  } catch (error) {
    throw writeError(path, error)
  }
}

const lockErrors = new WeakSet<OperateError>()

/** True for the CONFIG error of a lock that could not be taken (nothing was sent). */
export function isLockError(error: unknown): boolean {
  return error instanceof OperateError && lockErrors.has(error)
}

function lockError(path: string, cause: unknown): OperateError {
  const error = new OperateError(
    "CONFIG",
    `Cannot lock the token cache ${path}`,
    {
      hint: `Another operate process holds ${path}.lock. If no operate process is running, remove ${path}.lock; nothing was sent.`,
    },
    cause,
  )
  lockErrors.add(error)
  return error
}

type Outcome<T> = { readonly value: T } | { readonly error: unknown }

/**
 * Runs `action` holding the lock of the cache file `path`; the directory is created first (mode
 * 0700; the lock file lives in it). The holder may keep the lock for one token request plus 10 s.
 * A lock that cannot be taken is a CONFIG error that `isLockError` recognizes; errors of
 * `action` pass through unchanged.
 */
export async function withCacheLock<T>(
  path: string,
  deps: Pick<OAuthDeps, "fs" | "withLock" | "tokenDir" | "timeoutMs">,
  action: () => Promise<T>,
): Promise<T> {
  try {
    await deps.fs.mkdir(deps.tokenDir, { mode: 0o700 })
  } catch (error) {
    throw writeError(path, error)
  }
  let outcome: Outcome<T> | undefined
  try {
    await deps.withLock(`${path}.lock`, deps.timeoutMs + LOCK_GRACE_MS, async () => {
      try {
        outcome = { value: await action() }
      } catch (error) {
        outcome = { error }
      }
    })
  } catch (error) {
    throw lockError(path, error)
  }
  if (outcome === undefined) throw lockError(path, undefined)
  if ("error" in outcome) throw outcome.error
  return outcome.value
}
