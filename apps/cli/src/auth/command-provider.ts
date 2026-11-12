/**
 * The AuthProvider of PULSE_CLI_TOKEN_COMMAND: pulse runs the command when it needs a token, and
 * @miragon/pulse-http/oauth's `commandTokens` renews it by the shared policy, one run at a time:
 * all reads under way at once (as `status`, `inspect`, `wait` and `deploy` send several) and their
 * 401s wait for one run; a read that starts after a run failed runs the command again. A JWT with
 * `exp` is reused, also across calls (the cache file of command-cache.ts), until shortly before it
 * expires, then the command runs again, so a long `pulse wait` keeps a valid token; an opaque
 * token is reused within its call until a 401. After a 401 the command runs once more when the
 * token is old enough for a new one to help (30 s), and the request is retried when it printed
 * another token. `--dry-run` never runs the command: it shows a fresh token of this call or of the
 * cache, else a note.
 */

import { bearerCredential, type Credential, type TokenSource } from "@miragon/pulse-http"
import { commandTokens, EXPIRY, type TokenStore } from "@miragon/pulse-http/oauth"
import type { CommandBearerConfig } from "../config/types.js"
import { bearerRejectedHint, principalOf } from "./bearer.js"
import {
  type CommandCacheDeps,
  commandCachePath,
  commandEntry,
  type CommandToken,
  isFresh,
  readCommandToken,
  recordOf,
  writeCommandToken,
} from "./command-cache.js"
import { jwtClaims } from "./jwt.js"
import { iso } from "./oauth/errors.js"
import { type CommandDeps, runTokenCommand } from "./token-command.js"
import type { AuthPreview, AuthProvider, Principal } from "./types.js"

/** What the provider needs: running the command and the token cache. */
export type CommandProviderDeps = CommandDeps & CommandCacheDeps

function cachedNote(config: CommandBearerConfig, entry: CommandToken): string {
  return `Using the token of the bearer token command of ${config.origin}, cached until it expires at ${iso(entry.expiresAt ?? 0)}.`
}

/** Caches a JWT with `exp`; says so with --verbose. */
async function cached(entry: CommandToken, config: CommandBearerConfig, deps: CommandProviderDeps) {
  if (await writeCommandToken(await commandCachePath(config.command, deps), entry, deps)) {
    deps.trace?.({
      type: "note",
      message: `Cached the token until shortly before it expires at ${iso(entry.expiresAt ?? 0)}.`,
    })
  }
}

/** The cached token of the command while it is fresh, else undefined. */
async function freshCachedToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<CommandToken | undefined> {
  const entry = await readCommandToken(await commandCachePath(config.command, deps), deps)
  return entry === undefined || !isFresh(entry, deps.now()) ? undefined : entry
}

/** The cached token of the command while it is fresh, else undefined; says so with --verbose. */
async function cachedToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<CommandToken | undefined> {
  const entry = await freshCachedToken(config, deps)
  if (entry !== undefined) deps.trace?.({ type: "note", message: cachedNote(config, entry) })
  return entry
}

/**
 * The command's cache file as the package's TokenStore: a read hands over a fresh cached token
 * (the package takes it over unless a 401 refused it) and tells `offered`, a write caches a token
 * of known expiry; no lock: within a call the package runs the command once at a time, and
 * between calls a cache that cannot be used only makes the command run again.
 */
function commandStore(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
  offered: (entry: CommandToken | undefined) => void,
): TokenStore {
  return {
    async read() {
      const entry = await freshCachedToken(config, deps)
      offered(entry)
      return entry === undefined ? undefined : recordOf(entry)
    },
    write: (_key, record) =>
      cached(commandEntry(record.accessToken, record.receivedAt), config, deps),
    exclusive: (_key, work) => work(),
  }
}

/** The cached token of the command if it is still fresh, else a new one from the command. */
export async function commandToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<{ readonly entry: CommandToken; readonly cached: boolean }> {
  const entry = await cachedToken(config, deps)
  if (entry !== undefined) return { entry, cached: true }
  const fresh = commandEntry(await runTokenCommand(config, deps), deps.now())
  await cached(fresh, config, deps)
  return { entry: fresh, cached: false }
}

function header(entry: CommandToken): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${entry.token}` }
}

class CommandProvider implements AuthProvider {
  readonly type = "bearer"
  /** A bearer credential over the command's token, renewed by running the command again. */
  readonly credential: Credential = bearerCredential({
    renewable: true,
    token: () => this.token(),
    rejected: (sent) => this.refresh(sent),
  })
  private readonly tokens: TokenSource
  /** The token of this call and when it arrived. */
  private current: CommandToken | undefined
  /** How often the command ran in this call. */
  private runs = 0
  /** The command ran again after a 401, for the hint of the 401 that may follow. */
  private rerun = false
  /** The fresh token the cache offered last, so --verbose says so only when it was taken over. */
  private offered: CommandToken | undefined

  constructor(
    private readonly config: CommandBearerConfig,
    private readonly deps: CommandProviderDeps,
  ) {
    this.tokens = commandTokens(
      () => {
        this.runs += 1
        return runTokenCommand(config, deps)
      },
      {
        key: config.command,
        now: () => deps.now(),
        store: commandStore(config, deps, (entry) => {
          this.offered = entry
        }),
        policy: EXPIRY,
      },
    )
  }

  get principal(): Principal | undefined {
    return this.current === undefined
      ? undefined
      : principalOf(this.config.origin, jwtClaims(this.current.token))
  }

  /** The token of this call while it is fresh. */
  private fresh(): CommandToken | undefined {
    const { current } = this
    return current !== undefined && isFresh(current, this.deps.now()) ? current : undefined
  }

  /** The token of this call while it is fresh, else the cached one, else the command's. */
  private async token(): Promise<string | undefined> {
    const token = await this.tokens.token()
    if (token !== undefined && token !== this.current?.token) {
      this.current = commandEntry(token, this.deps.now())
      // Taken over from the cache, maybe after a 401 refused the one before.
      const cached = this.offered
      if (cached?.token === token) {
        this.deps.trace?.({ type: "note", message: cachedNote(this.config, cached) })
      }
    }
    return token
  }

  /** After a 401: runs the command again for a token old enough; true for another token. */
  private async refresh(sent: string): Promise<boolean> {
    const before = this.runs
    const renewed = await this.tokens.rejected(sent)
    this.rerun ||= this.runs > before
    return renewed
  }

  async preview(): Promise<AuthPreview> {
    const token = this.fresh() ?? (await cachedToken(this.config, this.deps))
    if (token !== undefined) return { headers: header(token) }
    return {
      headers: {},
      note: `pulse runs the bearer token command of ${this.config.origin} for the token when it sends the request; --dry-run does not run it.`,
    }
  }

  rejectedHint(status: number): string | undefined {
    const again = this.rerun
      ? "pulse ran the command again after the 401, and the engine rejected that token too (or the command printed the same one)"
      : "pulse ran the command for this request"
    const token = this.current?.token
    const rejected = {
      origin: `the command of ${this.config.origin}`,
      claims: token === undefined ? undefined : jwtClaims(token),
      now: this.deps.now(),
    }
    return bearerRejectedHint(
      status,
      rejected,
      `${again}. Check what the command prints and for which audience (\`pulse auth status\` shows the claims of its token).`,
    )
  }
}

export function commandBearerAuth(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): AuthProvider {
  return new CommandProvider(config, deps)
}
