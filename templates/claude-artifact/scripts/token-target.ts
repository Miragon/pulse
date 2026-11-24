/**
 * Where the recorder may send `MCP_TOKEN`: a bearer token goes only over TLS (RFC 6750 §5.3), or
 * over plain http to this machine's loopback interface, the rule the Pulse profiles hold their
 * credentials to (`credentialsInClearText` of `@miragon/pulse-profile`).
 */

const LOOPBACK_HOSTS = new Set(["localhost", "[::1]"])
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/

/** True for a host on the loopback interface: localhost, [::1] and all of 127.0.0.0/8. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || LOOPBACK_V4.test(hostname)
}

/**
 * Why the recorder refuses to send `token` to `url`: plain http to a host beyond the loopback
 * interface would carry it unencrypted. Null when it may (no token, https, or a loopback host).
 * The refusal names the host, never the token.
 */
export function clearTextTokenRefusal(url: URL, token: string | undefined): string | null {
  if (!token || url.protocol !== "http:" || isLoopbackHost(url.hostname)) return null
  return `MCP_TOKEN is set, but MCP_URL is plain http to ${url.host}, so the token would cross the network unencrypted. Use an https address for MCP_URL, or a loopback host (localhost, 127.0.0.1, [::1]).`
}
