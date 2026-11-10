/**
 * The cache of tokens that PULSE_CLI_TOKEN_COMMAND printed. A JWT with `exp` is kept in
 * `command-<hash>.json` of the token directory (mode 0600, written atomically), so later and
 * parallel commands do not run the command again: a token is reused until the shared policy of
 * @miragon/pulse-http/oauth renews it (`EXPIRY`: 60 s before its `exp`, at most a tenth of its
 * lifetime, at least 5 s; a dev realm token of 60 s is reused for 54 s). The hash covers the
 * command line and the scope: the directory of the project file in effect, else the working
 * directory, so `./token.sh` of two repositories never shares a token. Opaque tokens and JWTs
 * without `exp` are never cached. A cache file that cannot be read or written is ignored: the
 * command runs again.
 */

import { EXPIRY, isDue, type TokenRecord } from "@miragon/pulse-http/oauth"
import { normalizeToken } from "../config/bearer.js"
import { isRecord, sha256Hex } from "../util.js"
import { jwtClaims } from "./jwt.js"
import type { OAuthDeps } from "./oauth/types.js"

/** A token the command printed, with its expiry (epoch ms; null when unknown). */
export interface CommandToken {
  readonly token: string
  readonly expiresAt: number | null
  /** When the command printed it. */
  readonly fetchedAt: number
}

/** The token directory, and the scope whose commands share a cached token. */
export interface CommandCacheDeps extends Pick<OAuthDeps, "fs" | "tokenDir" | "tokenPath"> {
  readonly scope: string
}

/** A token printed at `fetchedAt`; its expiry is the `exp` claim of a JWT. */
export function commandEntry(token: string, fetchedAt: number): CommandToken {
  return { token, expiresAt: jwtClaims(token)?.expiresAt ?? null, fetchedAt }
}

/** The cache file of a command: `command-<first 32 hex chars of SHA-256([line, scope])>.json`. */
export async function commandCachePath(command: string, deps: CommandCacheDeps): Promise<string> {
  const hash = await sha256Hex(JSON.stringify([command, deps.scope]))
  return deps.tokenPath(`command-${hash.slice(0, 32)}.json`)
}

/** The cached token as @miragon/pulse-http/oauth's token record. */
export function recordOf(entry: CommandToken): TokenRecord {
  return {
    accessToken: entry.token,
    receivedAt: entry.fetchedAt,
    expiresAt: entry.expiresAt ?? undefined,
  }
}

/**
 * True while the token may still be sent without running the command again: until the shared
 * policy renews it (an opaque token after the policy's lifetime of 300 s).
 */
export function isFresh(entry: CommandToken, now: number): boolean {
  return !isDue(recordOf(entry), now, EXPIRY)
}

/** The cached JWT, if a usable cache file exists. Never throws. */
export async function readCommandToken(
  path: string,
  deps: CommandCacheDeps,
): Promise<CommandToken | undefined> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(await deps.fs.readFile(path)))
    if (!isRecord(value) || typeof value.token !== "string") return undefined
    const { fetchedAt } = value
    if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return undefined
    const entry = commandEntry(normalizeToken(value.token, "the token cache"), fetchedAt)
    return entry.expiresAt === null ? undefined : entry
  } catch {
    // a missing, unreadable or invalid file is no cache
    return undefined
  }
}

/**
 * Caches a token with a known expiry (atomically, 0600 in a 0700 directory); false when that is
 * not possible. Never throws: the token is still sent.
 */
export async function writeCommandToken(
  path: string,
  entry: CommandToken,
  deps: CommandCacheDeps,
): Promise<boolean> {
  if (entry.expiresAt === null) return false
  try {
    await deps.fs.mkdir(deps.tokenDir, { mode: 0o700 })
    const text = `${JSON.stringify({ token: entry.token, fetchedAt: entry.fetchedAt })}\n`
    await deps.fs.writeFile(path, text, { mode: 0o600 })
    return true
  } catch {
    return false
  }
}
