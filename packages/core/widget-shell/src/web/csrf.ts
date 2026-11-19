/**
 * The web app's CSRF check, for every request of a page that changes something (the API's calls,
 * the sign-out). SameSite=Lax keeps the session cookie off another site's POST already; this adds
 * what a browser reports of the request's source and a secret only a page of this origin can read:
 * a `Sec-Fetch-Site` other than same-origin (where the browser sends one) is refused, the `Origin`
 * must be `MCP_URL`'s origin, and the CSRF header must hold the session's secret, compared in
 * constant time.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { WEB_CSRF_HEADER } from "../protocol/web.js"

/** Why a request fails the check, for the log; the answer to the browser says only 403. */
export type CsrfRefusal = "cross-site" | "origin" | "no-token" | "wrong-token"

/** A new session's secret: 32 random bytes in base64url, which the page reads from the session route. */
export function newCsrfSecret(): string {
  return randomBytes(32).toString("base64url")
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest()

/** Equal digests, compared in constant time, so neither the secret's bytes nor its length leak. */
const sameSecret = (sent: string, secret: string): boolean =>
  timingSafeEqual(digest(sent), digest(secret))

/** `undefined` when a request may change something for the session holding `secret`, else why not. */
export function csrfRefusal(
  headers: Headers,
  { secret, origin }: { secret: string; origin: string },
): CsrfRefusal | undefined {
  const site = headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin") return "cross-site"
  if (headers.get("origin") !== origin) return "origin"
  const sent = headers.get(WEB_CSRF_HEADER)
  if (sent === null || sent === "") return "no-token"
  return sameSecret(sent, secret) ? undefined : "wrong-token"
}
