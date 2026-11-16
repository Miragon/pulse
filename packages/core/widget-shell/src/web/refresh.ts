/**
 * The session's access token, renewed with its refresh token by the policy every surface shares
 * (`@miragon/pulse-http/oauth`: `isDue`, `canRefresh`, `renewsAfterRefusal`). The session lives in
 * the browser's cookie, so each replica reads its tokens by its own clock: a receipt after `now`
 * (a token another replica received by a clock that runs ahead) counts as received now, never as a
 * token from the future, which the policy would renew on every call. One refresh per refresh token
 * runs at a time on a replica, and its outcome is kept 30 s for the calls that bring the same
 * cookie meanwhile, so with rotation a page's parallel calls take the new tokens instead of sending
 * the spent refresh token again. The provider's refusal of the refresh token ends the session; a
 * provider that does not answer keeps a token that has not expired.
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

/** How long a refresh's outcome is kept for the calls that bring the same refresh token. */
export const RENEWAL_KEPT_MS = 30_000

/** Tokens that carry a refresh token. */
export type RenewableTokens = SessionTokens & { readonly refreshToken: string }

/** What a refresh came to: the new tokens, the provider's refusal, or no answer. */
export type Renewal =
  | { readonly kind: "renewed"; readonly tokens: SessionTokens }
  | { readonly kind: "refused" }
  | { readonly kind: "unavailable" }

/** Renews the tokens with their refresh token, one refresh per refresh token at a time. */
export type RenewalSource = (tokens: RenewableTokens) => Promise<Renewal>

/** What a call does with the session's tokens before it is forwarded. */
export type TokenStep =
  | { readonly kind: "send" }
  | { readonly kind: "renew"; readonly tokens: RenewableTokens }
  | { readonly kind: "end" }

const REFUSED: Renewal = { kind: "refused" }
const UNAVAILABLE: Renewal = { kind: "unavailable" }

/** The tokens as this replica's clock reads them: received no later than `now`. */
export function seenAt(tokens: SessionTokens, now: number): SessionTokens {
  return tokens.receivedAt > now ? { ...tokens, receivedAt: now } : tokens
}

/**
 * Send the token, renew it first (it is due and can be renewed), or end the session (it expired
 * and nothing renews it). A token that is due but cannot be renewed goes out until it expires.
 */
export function tokenStep(tokens: SessionTokens, now: number): TokenStep {
  const seen = seenAt(tokens, now)
  if (!isDue(seen, now)) return { kind: "send" }
  if (canRefresh(seen, now)) return { kind: "renew", tokens: seen }
  return isExpired(seen, now) ? { kind: "end" } : { kind: "send" }
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
  try {
    return {
      kind: "renewed",
      tokens: merged(tokens, await requestToken(endpoint, grant, ctx.platform)),
    }
  } catch (error) {
    ctx.log(`Web session: the refresh gave no token (${(error as Error).message}).`)
    return passesBy(error) ? UNAVAILABLE : REFUSED
  }
}

/** A refresh under way, or its outcome, kept until `keptUntil`. */
interface Run {
  readonly renewal: Promise<Renewal>
  readonly keptUntil: number
}

/** The key a refresh token's run is kept under: its SHA-256, so no map holds it in clear. */
const keyOf = (refreshToken: string): string =>
  createHash("sha256").update(refreshToken).digest("base64url")

/**
 * This replica's refreshes: one per refresh token at a time, its outcome kept 30 s, except a
 * provider that did not answer, which the next call asks again.
 */
export function renewalSource(ctx: WebContext): RenewalSource {
  const runs = new Map<string, Run>()
  const settle = (key: string, renewal: Renewal): Renewal => {
    const keptUntil = ctx.platform.now() + RENEWAL_KEPT_MS
    if (renewal.kind === "unavailable") runs.delete(key)
    else runs.set(key, { renewal: Promise.resolve(renewal), keptUntil })
    return renewal
  }
  return (tokens) => {
    const now = ctx.platform.now()
    for (const [key, run] of runs) if (run.keptUntil <= now) runs.delete(key)
    const key = keyOf(tokens.refreshToken)
    const running = runs.get(key)
    if (running !== undefined) return running.renewal
    const renewal = renewed(ctx, tokens).then((outcome) => settle(key, outcome))
    runs.set(key, { renewal, keptUntil: Number.POSITIVE_INFINITY })
    return renewal
  }
}
