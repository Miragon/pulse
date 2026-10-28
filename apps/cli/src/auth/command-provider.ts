/**
 * The AuthProvider of PULSE_CLI_TOKEN_COMMAND: pulse-cli runs the command when it needs a
 * token. A JWT with `exp` is reused, also across calls (command-cache.ts), until shortly before it
 * expires, then the command runs again, so a long `pulse-cli wait` keeps a valid token; an opaque
 * token is fetched once per call. After a 401 the command runs once more and the request is
 * retried with the new token (the client retries a request once). `--dry-run` never runs the
 * command: it shows a fresh token of this call or of the cache, else a note.
 */

import type { CommandBearerConfig } from "../config/types.js"
import { bearerRejectedHint, principalOf } from "./bearer.js"
import {
  type CommandCacheDeps,
  commandCachePath,
  commandEntry,
  type CommandToken,
  isFresh,
  readCommandToken,
  writeCommandToken,
} from "./command-cache.js"
import { jwtClaims } from "./jwt.js"
import { type CommandDeps, runTokenCommand } from "./token-command.js"
import type { AuthPreview, AuthProvider, Principal } from "./types.js"

/** What the provider needs: running the command and the token cache. */
export type CommandProviderDeps = CommandDeps & CommandCacheDeps

/** Runs the command; caches a JWT with `exp`. */
async function fetchCommandToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<CommandToken> {
  const entry = commandEntry(await runTokenCommand(config, deps), deps.now())
  if (await writeCommandToken(await commandCachePath(config.command, deps), entry, deps)) {
    deps.trace?.({
      type: "note",
      message: `Cached the token until shortly before it expires at ${new Date(entry.expiresAt ?? 0).toISOString()}.`,
    })
  }
  return entry
}

/** The cached token of the command while it is fresh, else undefined. */
async function cachedToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<CommandToken | undefined> {
  const cached = await readCommandToken(await commandCachePath(config.command, deps), deps)
  if (cached === undefined || !isFresh(cached, deps.now())) return undefined
  deps.trace?.({
    type: "note",
    message: `Using the token of the bearer token command of ${config.origin}, cached until it expires at ${new Date(cached.expiresAt ?? 0).toISOString()}.`,
  })
  return cached
}

/** The cached token of the command if it is still fresh, else a new one from the command. */
export async function commandToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<{ readonly entry: CommandToken; readonly cached: boolean }> {
  const cached = await cachedToken(config, deps)
  return cached === undefined
    ? { entry: await fetchCommandToken(config, deps), cached: false }
    : { entry: cached, cached: true }
}

function header(entry: CommandToken): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${entry.token}` }
}

class CommandProvider implements AuthProvider {
  readonly type = "bearer"
  private current: CommandToken | undefined
  /** The command ran again after a 401, for the hint of the 401 that may follow. */
  private rerun = false

  constructor(
    private readonly config: CommandBearerConfig,
    private readonly deps: CommandProviderDeps,
  ) {}

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

  async headers(): Promise<Readonly<Record<string, string>>> {
    // the cache first: a parallel command may have run the command already
    this.current = this.fresh() ?? (await commandToken(this.config, this.deps)).entry
    return header(this.current)
  }

  /** After a 401: runs the command again; true when it printed another token. */
  async refresh(): Promise<boolean> {
    this.rerun = true
    const before = this.current?.token
    this.current = await fetchCommandToken(this.config, this.deps)
    return this.current.token !== before
  }

  async preview(): Promise<AuthPreview> {
    const token = this.fresh() ?? (await cachedToken(this.config, this.deps))
    if (token !== undefined) return { headers: header(token) }
    return {
      headers: {},
      note: `pulse-cli runs the bearer token command of ${this.config.origin} for the token when it sends the request; --dry-run does not run it.`,
    }
  }

  rejectedHint(status: number): string | undefined {
    const again = this.rerun
      ? "pulse-cli ran the command again after the 401, and the engine rejected that token too (or the command printed the same one)"
      : "pulse-cli ran the command for this request"
    const token = this.current?.token
    const rejected = {
      origin: `the command of ${this.config.origin}`,
      claims: token === undefined ? undefined : jwtClaims(token),
      now: this.deps.now(),
    }
    return bearerRejectedHint(
      status,
      rejected,
      `${again}. Check what the command prints and for which audience (\`pulse-cli auth status\` shows the claims of its token).`,
    )
  }
}

export function commandBearerAuth(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): AuthProvider {
  return new CommandProvider(config, deps)
}
