/**
 * The session's access token, renewed with its refresh token by the policy every surface shares
 * (`@miragon/pulse-http/oauth`: `isDue`, `canRefresh`, `renewsAfterRefusal`), as the backend for
 * frontend of OAuth 2.0 for Browser-Based Applications renews it: when it is due, and the session
 * ends when the provider refuses the renewal. With `MCP_WEB_SESSION_CHECK_MINUTES` a token is due
 * that long after its receipt too, so a session the provider ended, a user it disabled or access it
 * revoked ends within that interval, whatever the token's lifetime, and so does a session whose
 * refresh token expired (the provider's session is over); unset, a token is due only shortly before
 * it expires. The receipt is sealed in the cookie and renewed with every refresh, so every replica
 * reads it without a store, each by its own clock: for the expiry a receipt after `now` (a token
 * another replica received by a clock that runs ahead) counts as received now, never as a token
 * from the future, which the policy would renew on every call; for the check a receipt more than a
 * minute ahead makes it due at once, so such a replica never postpones it on the others.
 *
 * One refresh per pair of tokens runs at a time on a replica, within 10 s, and its outcome is kept
 * for the calls that bring the same cookie meanwhile: new tokens and a refusal 30 s (new tokens no
 * longer than they hold), no answer 5 s. So with rotation a page's parallel calls take the new
 * tokens instead of sending the spent refresh token again, a cookie that holds new tokens renews
 * them again (the same refresh token too, where the provider keeps it), and a silent provider costs
 * one wait per 5 s. A refusal is struck: the first of a pair at this replica may be a race with a
 * call on another replica that spent its refresh token (the browser comes back with that replica's
 * cookie), so the forward (forward.ts) still sends a token that holds; the replica remembers the
 * pair while its access token holds and at least one check's interval, and a second refusal of it
 * meanwhile is final, which ends the session.
 */
import { createHash } from "node:crypto"
import {
  canRefresh,
  isDue,
  isExpired,
  renewsAfterRefusal,
  requestToken,
  type TokenRecord,
} from "@miragon/pulse-http/oauth"
import { passesBy, type WebContext } from "./context.js"
import type { SessionTokens } from "./session.js"
import type { WebSettings } from "./settings.js"

/** How long a refresh's new tokens or refusal is kept for the calls that bring the same tokens. */
export const RENEWAL_KEPT_MS = 30_000

/**
 * How long a refresh the provider did not answer is kept: the transport's hold of a silent endpoint
 * (`TokenFailure`'s `holdMs` of one that is unavailable), copied, since `@miragon/pulse-http/oauth`
 * exports it as no name of its own; a test holds the two equal.
 */
export const SILENT_KEPT_MS = 5_000

/** A refresh's deadline: shorter than the transport's 30 s, since a page's call waits for it. */
export const REFRESH_TIMEOUT_MS = 10_000

/** How far a receipt may lie after this replica's clock before the check finds it due. */
export const CLOCK_AHEAD_MS = 60_000

const MINUTE_MS = 60_000

/** Tokens that carry a refresh token. */
export type RenewableTokens = SessionTokens & { readonly refreshToken: string }

/**
 * What a refresh came to: the new tokens, the provider's refusal (`final` where this replica saw
 * it refuse the same tokens before), or no answer.
 */
export type Renewal =
  | { readonly kind: "renewed"; readonly tokens: SessionTokens }
  | { readonly kind: "refused"; readonly final: boolean }
  | { readonly kind: "unavailable" }

/** Renews the tokens with their refresh token, one refresh per pair of tokens at a time. */
export type RenewalSource = (tokens: RenewableTokens) => Promise<Renewal>

/** What a call does with the session's tokens before it is forwarded; an end says why, to log. */
export type TokenStep =
  | { readonly kind: "send" }
  | { readonly kind: "renew"; readonly tokens: RenewableTokens }
  | { readonly kind: "end"; readonly why: string }

const SEND: TokenStep = { kind: "send" }
const EXPIRED: TokenStep = { kind: "end", why: "the session's token expired and nothing renews it" }
const UNCHECKED: TokenStep = {
  kind: "end",
  why: "the session's check is due and its refresh token expired",
}

const FIRST_REFUSAL: Renewal = { kind: "refused", final: false }
const FINAL_REFUSAL: Renewal = { kind: "refused", final: true }
const UNAVAILABLE: Renewal = { kind: "unavailable" }

/** The interval of the session's check at the provider, `undefined` where none runs. */
export const checkMsOf = ({ sessionCheckMinutes }: WebSettings): number | undefined =>
  sessionCheckMinutes === undefined ? undefined : sessionCheckMinutes * MINUTE_MS

/** The tokens as this replica's clock reads them: received no later than `now`. */
export function seenAt(tokens: SessionTokens, now: number): SessionTokens {
  return tokens.receivedAt > now ? { ...tokens, receivedAt: now } : tokens
}

/**
 * Whether the session's check at the provider is due at `now`: its tokens were received `checkMs`
 * ago or longer, or more than a minute after `now` by another replica's clock; never without a check.
 */
export function isCheckDue(
  tokens: SessionTokens,
  now: number,
  checkMs: number | undefined,
): boolean {
  if (checkMs === undefined) return false
  const age = now - tokens.receivedAt
  return age >= checkMs || age < -CLOCK_AHEAD_MS
}

/**
 * Send the token, renew it first (it is due by its expiry or the check and can be renewed), or end
 * the session: it expired and nothing renews it, or the check is due and its refresh token expired,
 * so the provider's session is over and nothing can check it. A token that is due but cannot be
 * renewed goes out until it expires otherwise: without a check, and without a refresh token, whose
 * sign-in the provider allowed so.
 */
export function tokenStep(tokens: SessionTokens, now: number, checkMs?: number): TokenStep {
  const seen = seenAt(tokens, now)
  const checkDue = isCheckDue(tokens, now, checkMs)
  if (!isDue(seen, now) && !checkDue) return SEND
  if (canRefresh(seen, now)) return { kind: "renew", tokens: seen }
  if (isExpired(seen, now)) return EXPIRED
  return checkDue && seen.refreshToken !== undefined ? UNCHECKED : SEND
}

/**
 * Whether a token goes out while the provider does not answer its refresh: it has not expired, and
 * with a check it is younger than two intervals, so an outage holds a session for one more
 * interval at most and is no revocation.
 */
export function holdsWhileSilent(
  tokens: SessionTokens,
  now: number,
  checkMs: number | undefined,
): boolean {
  if (isExpired(tokens, now)) return false
  return checkMs === undefined || now - tokens.receivedAt < 2 * checkMs
}

/**
 * The tokens to renew after the gate refused their access token: only one old enough by this
 * replica's clock that a new one may help, with a refresh token that can renew it.
 */
export function renewableAfterRefusal(
  tokens: SessionTokens,
  now: number,
): RenewableTokens | undefined {
  const seen = seenAt(tokens, now)
  return renewsAfterRefusal(seen, now) && canRefresh(seen, now) ? seen : undefined
}

/**
 * The session's tokens after a refresh: the new access token and its expiry; the new refresh
 * token where the provider rotated it (the old one is spent), else the old one with its expiry.
 */
function merged(old: RenewableTokens, fresh: TokenRecord): SessionTokens {
  const rotated = fresh.refreshToken !== undefined
  return {
    accessToken: fresh.accessToken,
    receivedAt: fresh.receivedAt,
    expiresAt: fresh.expiresAt,
    refreshToken: fresh.refreshToken ?? old.refreshToken,
    refreshExpiresAt: fresh.refreshExpiresAt ?? (rotated ? undefined : old.refreshExpiresAt),
  }
}

/** One refresh at the provider's token endpoint, as the confidential client of the sign-in. */
async function renewed(ctx: WebContext, tokens: RenewableTokens): Promise<Renewal> {
  const metadata = await ctx.metadata()
  if (metadata === undefined) return UNAVAILABLE
  const { clientId, clientSecret } = ctx.settings
  const endpoint = {
    url: metadata.tokenEndpoint,
    clientId,
    clientSecret,
    clientAuth: metadata.clientAuth,
  }
  const grant = {
    type: "refresh_token",
    refreshToken: tokens.refreshToken,
    resources: [ctx.resource],
  } as const
  const limits = { timeoutMs: REFRESH_TIMEOUT_MS }
  try {
    const fresh = await requestToken(endpoint, grant, ctx.platform, limits)
    return { kind: "renewed", tokens: merged(tokens, fresh) }
  } catch (error) {
    ctx.log(`Web session: the refresh gave no token (${(error as Error).message}).`)
    return passesBy(error) ? UNAVAILABLE : FIRST_REFUSAL
  }
}

/** A refresh under way, or its outcome, kept until `keptUntil`. */
interface Run {
  readonly renewal: Promise<Renewal>
  readonly keptUntil: number
}

/**
 * The key a refresh's run and a refusal are kept under: the SHA-256 of the refresh token and the
 * access token it renews, so no map holds either in clear, and a cookie with the renewed pair
 * renews again even where the provider kept the refresh token.
 */
const keyOf = ({ refreshToken, accessToken }: RenewableTokens): string =>
  createHash("sha256")
    .update(JSON.stringify([refreshToken, accessToken]))
    .digest("base64url")

/** Until when a refresh's outcome is kept: 30 s, new tokens no longer than they hold, no answer 5 s. */
function keptUntilOf(renewal: Renewal, now: number): number {
  if (renewal.kind === "unavailable") return now + SILENT_KEPT_MS
  const kept = now + RENEWAL_KEPT_MS
  if (renewal.kind === "refused") return kept
  return Math.min(kept, renewal.tokens.expiresAt ?? kept)
}

/** Until when a refused pair is remembered: while its access token holds, and one check's interval. */
const struckUntil = (tokens: RenewableTokens, now: number, checkMs: number | undefined): number =>
  Math.max(now + (checkMs ?? 0), tokens.expiresAt ?? now)

/** Drops the entries whose time passed at `now`. */
function dropPassed<T>(entries: Map<string, T>, now: number, until: (entry: T) => number): void {
  for (const [key, entry] of entries) if (until(entry) <= now) entries.delete(key)
}

/**
 * This replica's refreshes: one per pair of tokens at a time, its outcome kept as `keptUntilOf`
 * says, and a refusal struck: final where the replica remembers a refusal of the same pair.
 */
export function renewalSource(ctx: WebContext): RenewalSource {
  const checkMs = checkMsOf(ctx.settings)
  const runs = new Map<string, Run>()
  const struck = new Map<string, number>()
  const strike = (key: string, tokens: RenewableTokens, now: number): Renewal => {
    dropPassed(struck, now, (until) => until)
    const final = struck.has(key)
    struck.set(key, struckUntil(tokens, now, checkMs))
    return final ? FINAL_REFUSAL : FIRST_REFUSAL
  }
  const settle = (key: string, tokens: RenewableTokens, renewal: Renewal): Renewal => {
    const now = ctx.platform.now()
    const outcome = renewal.kind === "refused" ? strike(key, tokens, now) : renewal
    runs.set(key, { renewal: Promise.resolve(outcome), keptUntil: keptUntilOf(outcome, now) })
    return outcome
  }
  return (tokens) => {
    const now = ctx.platform.now()
    dropPassed(runs, now, (run) => run.keptUntil)
    const key = keyOf(tokens)
    const running = runs.get(key)
    if (running !== undefined) return running.renewal
    const renewal = renewed(ctx, tokens).then((outcome) => settle(key, tokens, outcome))
    runs.set(key, { renewal, keptUntil: Number.POSITIVE_INFINITY })
    return renewal
  }
}
