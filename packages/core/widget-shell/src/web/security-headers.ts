/**
 * What every answer under `/app` carries, the page, its assets, the sign-in's and the API's answers
 * and a 404 alike. The policy lets the page run only its own scripts, from files of the build (no
 * inline script, no `eval`), and reach only its own origin; styles may be inline, since bpmn-js,
 * diagram-js and the view runtime set style elements of their own. No form posts anywhere (the
 * sign-out is a fetch), no site frames the page and no `<base>` moves its URLs. A browser sniffs no
 * type, sends no `Referer` (a page's query names engines and instances), keeps no window of another
 * origin in the page's group, and loads its files into this origin's pages alone. On https, the
 * browser keeps to https for a year, for this host only: a sibling host may still serve plain http.
 */

/** The page's Content Security Policy. */
export const WEB_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ")

/** A year, in seconds. */
const HSTS_MAX_AGE = 31_536_000

/** The headers of every answer under `/app` of an app reached at `origin` (`MCP_URL`'s). */
export function webSecurityHeaders(origin: string): Readonly<Record<string, string>> {
  const https = new URL(origin).protocol === "https:"
  return {
    "content-security-policy": WEB_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    ...(https ? { "strict-transport-security": `max-age=${HSTS_MAX_AGE}` } : {}),
  }
}
