/**
 * The URL rules of a profile, which the readers also apply to a URL from elsewhere (the CLI's
 * flags and environment): the REST root and the web app are http or https, without credentials,
 * a query or a fragment. And the one loopback definition, for the rule that a credential never
 * travels over plain http beyond the local machine.
 */

import type { AuthType } from "./types.js"

/**
 * The global URL of every runtime the readers run in (Node.js, the VS Code extension host, a
 * browser). Declared here because the package compiles without DOM and Node types, so that
 * `process` or `document` stay compile errors.
 */
declare const URL: new (input: string) => {
  readonly protocol: string
  readonly username: string
  readonly password: string
  readonly hostname: string
}

/** What is wrong with a URL; each is a code of the verdict. */
export type UrlProblemCode =
  "url-invalid" | "url-credentials" | "url-not-http" | "url-query-or-fragment"

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "[::1]"])
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function parsed(url: string) {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/**
 * Why `url` (blanks around it ignored) is no usable REST root or web app address, or undefined.
 * Credentials are checked first: a URL that carries them is never repeated anywhere.
 */
export function urlProblem(url: string): UrlProblemCode | undefined {
  const trimmed = url.trim()
  const address = parsed(trimmed)
  if (address === undefined) return "url-invalid"
  if (address.username !== "" || address.password !== "") return "url-credentials"
  if (address.protocol !== "http:" && address.protocol !== "https:") return "url-not-http"
  return /[?#]/.test(trimmed) ? "url-query-or-fragment" : undefined
}

/**
 * `text` without the run of `chars` at its end. A loop from the end, not `replace(/[…]+$/)`: that
 * pattern retries at every position of a long run that something else follows, quadratic in the
 * length of a value the readers do not control.
 */
function withoutTrailing(text: string, chars: string): string {
  let end = text.length
  while (end > 0 && chars.includes(text.charAt(end - 1))) end -= 1
  return text.slice(0, end)
}

/** A REST root as a profile keeps it: trimmed, without trailing slashes. */
export function normalizeUrl(url: string): string {
  return withoutTrailing(url.trim(), "/")
}

/**
 * A web app address as a profile keeps it: trimmed, without trailing slashes and without the
 * trailing `#` or `#/` of a single-page app's start route, which a link appends its own route to.
 */
export function normalizeCockpitUrl(url: string): string {
  return withoutTrailing(url.trim(), "/#")
}

/** True for a host on the loopback interface: localhost, [::1] and all of 127.0.0.0/8. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || LOOPBACK_V4.test(hostname)
}

/**
 * True when a profile of `authType` would send its credentials over plain http to a host beyond
 * the loopback interface (RFC 6750 §5.3 and RFC 7617 §4 ask for TLS). Each reader decides what
 * follows: a warning, or a refusal.
 */
export function credentialsInClearText(url: string, authType: AuthType): boolean {
  if (authType === "none") return false
  const address = parsed(url.trim())
  return address?.protocol === "http:" && !isLoopbackHost(address.hostname)
}
