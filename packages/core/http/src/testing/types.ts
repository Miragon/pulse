import type { FailureReason } from "../failure.js"
import type { Intent } from "../types.js"

/** Where the case's engine listens. */
export type Endpoint =
  /** A plain HTTP engine on 127.0.0.1. */
  | "loopback"
  /** An HTTPS engine on 127.0.0.1 behind a self-signed certificate: the handshake fails. */
  | "self-signed-tls"
  /**
   * Port 2 on 127.0.0.1, which nothing listens on: a port below 1024 the fetch standard does not
   * block and a test is never handed (an OS hands out ephemeral ports only), unlike a released one.
   */
  | "closed-port"
  /** A host under .invalid (RFC 6761), which no resolver answers. */
  | "unresolvable-host"

/** The credential of a case, as each wiring builds it from its own sources. */
export type CaseCredential =
  | { readonly type: "none" }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  /** A fixed bearer token as configured (a line break included). */
  | { readonly type: "bearer"; readonly token: string }
  /** Passthrough: the token of whoever calls. */
  | { readonly type: "caller"; readonly token: string }
  /** A provider that renews: each 401 to its current token moves to the next, while there is one. */
  | { readonly type: "renewable"; readonly tokens: readonly string[] }

export interface CaseConnection {
  readonly endpoint: Endpoint
  /** The API root's path as configured, after the engine's origin (`/engine-rest//` included). */
  readonly root: string
  readonly credential: CaseCredential
  readonly timeoutMs: number
  readonly maxAnswerBytes?: number
  readonly readOnly?: boolean
}

export interface CaseRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE"
  /** Below the root, `{name}` for each path value. */
  readonly path: string
  /** The path values, as a caller would hand them over (`.` and `..` included). */
  readonly values?: Readonly<Record<string, string>>
  readonly intent: Intent
  /** JSON text, sent as application/json. */
  readonly body?: string
  /** The wiring reads the answer as JSON: a body that does not parse is an invalid answer. */
  readonly expects?: "json"
  /** The caller aborts the request (its own AbortSignal) this many ms after sending it. */
  readonly cancelAfterMs?: number
}

/** One answer of the engine. */
export interface CaseAnswer {
  /** Default 200, always without a reason phrase, as Tomcat answers. */
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  /** UTF-8 text. */
  readonly body?: string
  /** Instead of `body`: this many bytes of `x`. */
  readonly bytes?: number
  /** Announce the length (Content-Length); otherwise the body goes chunked. */
  readonly announce?: boolean
  /** `headers`: never answers; `body`: sends the status line and headers, never the body. */
  readonly hang?: "headers" | "body"
  /** Sends the body in `chunks` parts, one every `everyMs`. */
  readonly trickle?: { readonly chunks: number; readonly everyMs: number }
  /** Closes the connection once the request arrived, without an answer. */
  readonly reset?: boolean
}

export interface CaseExpectation {
  readonly outcome: "answered" | FailureReason
  readonly status?: number
  /** For a failure: whether a write may have been applied. */
  readonly mayHaveApplied?: boolean
  /** How many requests reached the engine. */
  readonly sent: number
  /** The Authorization of each request the engine saw, `null` for none. */
  readonly authorization?: readonly (string | null)[]
  /** The request target of each request the engine saw, as it reached the socket. */
  readonly targets?: readonly string[]
  /** The body of each request the engine saw. */
  readonly bodies?: readonly string[]
  /** Texts the observation shows: an answer's text, a failure's message and details. */
  readonly contains?: readonly string[]
  /** Texts no observation may show: the secrets of the case. */
  readonly never?: readonly string[]
}

/**
 * A conformance case of the transport: a connection, one request, the engine's answers and what
 * every wiring must observe. Each wiring (the package's own, the MCP server's SDK client, the
 * CLI's commands, Pulse for VS Code's adapters) runs every case its surface can express
 * (`casesFor`) against a recording engine on loopback and maps what it got onto an
 * {@link Observed}.
 */
export interface TransportCase {
  /** Where a case is one of the error-path goldens too, it has that golden's name. */
  readonly name: string
  readonly about: string
  readonly connection: CaseConnection
  readonly request: CaseRequest
  /** In order; the last answers every request after it. Empty where no request arrives. */
  readonly answers: readonly CaseAnswer[]
  readonly expect: CaseExpectation
}

/** What a wiring observed for a case. */
export interface Observed {
  readonly outcome: "answered" | FailureReason
  readonly status?: number
  readonly mayHaveApplied?: boolean
  /** Everything the wiring would show: the answer's text, or the failure's message and details. */
  readonly text: string
}

/** A request as the engine saw it. */
export interface Seen {
  readonly method: string
  readonly target: string
  readonly authorization?: string
  readonly body: string
}
