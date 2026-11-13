/**
 * What a failed `fetch` threw, read as a reason. Node's fetch throws `TypeError("fetch failed")`
 * with the system error as its cause (an AggregateError when every address was tried), so the
 * code decides: a failure before the connection exists (refused, no route, DNS, the TLS
 * handshake) sent nothing; any other one may have come after the server read the request, a TLS
 * error after the handshake (a bad record, a renegotiation) included.
 */
import type { FailureReason } from "./failure.js"

/**
 * A handshake that failed before any request left: the certificate checks (OpenSSL's verify
 * codes as Node names them), a name the certificate does not hold, a server that speaks no TLS
 * or no common version, an alert of the handshake. Any other TLS or OpenSSL code may come after
 * the request left, so it reads as a broken connection.
 */
const TLS_CODES: ReadonlySet<string> = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_CHAIN_TOO_LONG",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "PATH_LENGTH_EXCEEDED",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_UNSUPPORTED_PROTOCOL",
  "ERR_SSL_NO_PROTOCOLS_AVAILABLE",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
  "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
  "ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE",
  "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
])

const DNS_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NONAME",
  "EAI_NODATA",
])

const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "ENETDOWN",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
])

/** undici refuses to build the request: nothing reached the network. */
const INVALID_CODES: ReadonlySet<string> = new Set([
  "UND_ERR_INVALID_ARG",
  "UND_ERR_NOT_SUPPORTED",
  "ERR_INVALID_URL",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
  "ERR_INVALID_HTTP_TOKEN",
  "ERR_INVALID_CHAR",
])

/** A system code as a message may show it; anything else is dropped. */
const SYSTEM_CODE = /^[A-Z][A-Z\d_]{1,63}$/

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined

const codeOf = (value: unknown): string | undefined => {
  const code = fieldOf(value, "code")
  return typeof code === "string" && SYSTEM_CODE.test(code) ? code : undefined
}

/** The system code of a thrown error: its cause's, the first of an AggregateError's, its own. */
export function systemCode(error: unknown): string | undefined {
  const cause = fieldOf(error, "cause")
  const errors = fieldOf(cause, "errors")
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined
  return codeOf(cause) ?? codeOf(first) ?? codeOf(error)
}

/** The reason a system code stands for; an unknown or missing code is a broken connection. */
export function reasonOfCode(code: string | undefined): FailureReason {
  if (code === undefined) return "connection"
  if (TLS_CODES.has(code)) return "tls"
  if (DNS_CODES.has(code)) return "dns"
  if (UNREACHABLE_CODES.has(code)) return "unreachable"
  return INVALID_CODES.has(code) ? "invalid-request" : "connection"
}
