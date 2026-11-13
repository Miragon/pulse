import type { Credential } from "./credential.js"
import type { IntegerMode } from "./json.js"

/**
 * What a request does to the server's state. Never guessed from the method: a POST that only
 * queries (a search with a body) is a read, and the caller says so. Fail-closed: a request not
 * marked as a read (a JavaScript caller's typo, an intent no route gave) counts as a write.
 */
export type Intent = "read" | "write"

/** What each surface builds from its resolved profile: where to, with what, and how long. */
export interface Connection {
  /** The API root: an absolute http(s) URL without credentials, query or fragment. */
  readonly url: string
  readonly credential: Credential
  /**
   * The deadline of one attempt in ms, from sending to the last byte of the answer: a positive
   * integer up to 2147483647.
   */
  readonly timeoutMs: number
  /** The largest answer body in bytes: {@link MAX_ANSWER_BYTES} by default, Infinity for none. */
  readonly maxAnswerBytes?: number
  /** Sent with every request; a request's own headers and the credential's win. */
  readonly headers?: Readonly<Record<string, string>>
  /**
   * Names of further headers that carry a secret (an API key): their values are kept out of
   * every trace (but one that reveals them, `Platform.revealSecrets`) and masked in every text
   * from the server. Authorization, Proxy-Authorization and Cookie always are.
   */
  readonly secretHeaders?: readonly string[]
  /** Any request not marked as a read fails before sending ("refused-write"). */
  readonly readOnly?: boolean
  readonly userAgent?: string
}

/**
 * Every effect from outside: the `fetch` (Node's global, the VS Code extension host's, which
 * carries its proxy and certificates, a fake in a test), the clock and the trace.
 */
export interface Platform {
  readonly fetch: typeof fetch
  now(): number
  /** Watches each attempt; what it throws is dropped, so it never changes an outcome. */
  trace?(event: TraceEvent): void
  /**
   * Whether the trace shows the secrets of a request as sent: the value of every secret header
   * and a secret in the URL. Off unless set, so a trace names each secret header and shows `***`
   * for its value. Set it only when a person asked for the secrets on this run (the CLI's
   * `--show-secrets`); no server and no editor sets it. Error answers and failures stay masked
   * either way.
   */
  readonly revealSecrets?: boolean
}

/** A request, its URL built by the caller (see `joinUrl`, `encodePathValue`). */
export interface HttpRequest {
  readonly method: string
  /** Absolute, below the connection's root. */
  readonly url: string
  readonly intent: Intent
  readonly headers?: Readonly<Record<string, string>>
  /** Repeatable (no stream), so a second attempt after a 401 sends it again. */
  readonly body?: string | Uint8Array<ArrayBuffer> | FormData
  /** The caller's abort, honoured for a read only: aborting a write that left cannot undo it. */
  readonly signal?: AbortSignal
}

/** An answer: every status but a 3xx is one (`send`). */
export interface HttpAnswer {
  readonly status: number
  /** The server's reason phrase, or the standard one when it sends none (Tomcat). */
  readonly statusText: string
  readonly contentType: string
  /** Names in lower case. */
  readonly headers: Readonly<Record<string, string>>
  /** As received; from status 400 on, with every secret of the request masked. */
  readonly body: Uint8Array<ArrayBuffer>
}

/**
 * One trace event per attempt and per answer, a 3xx included; no event carries a secret unless
 * the platform reveals them (`Platform.revealSecrets`).
 */
export type TraceEvent =
  | {
      readonly type: "request"
      readonly method: string
      /** Masked like every text: a secret in the query reads `***`. */
      readonly url: string
      /**
       * As written: the connection's, the request's, the credential's Authorization and the
       * User-Agent, each name in its caller's spelling and in that order. The value of every
       * secret header reads `***`, behind the scheme word of an Authorization (`Basic ***`), and
       * a secret of the request in any other header is masked as in every text.
       */
      readonly headers: Readonly<Record<string, string>>
      /** The names (lower case) of the secret headers among them. */
      readonly secretHeaders: readonly string[]
    }
  | {
      readonly type: "response"
      readonly status: number
      /** As in the answer: from status 300 on with the request's secrets masked. */
      readonly statusText: string
      /** From sending until the last byte of the body. */
      readonly durationMs: number
      /** The body's size as the server sent it, before any mask; none for a 3xx, never read. */
      readonly bytes?: number
    }

export interface AsFetchOptions {
  /** What a request of the SDK does; never guessed from the method. */
  intentOf(request: Request): Intent
  /**
   * What an integer beyond 2^53 in a JSON answer becomes for the SDK, which parses with
   * `JSON.parse`: `"number"` (the body as received; the SDK rounds it) or `"string"` (its exact
   * digits as a string).
   */
  readonly integers?: Extract<IntegerMode, "number" | "string">
}

export interface Http {
  /** The API root, normalized and without trailing slashes. */
  readonly root: string
  /**
   * Every status is an answer; anything else fails with an HttpFailure, but what the credential
   * throws itself besides a CredentialError (a token source's own failure, see `TokenSource`).
   */
  send(request: HttpRequest): Promise<HttpAnswer>
  /** Like `send`, but a status from 400 on fails ("unauthorized", "status"). */
  call(request: HttpRequest): Promise<HttpAnswer>
  /** Like `call`, then the body as JSON: undefined when empty, "invalid-answer" when no JSON. */
  json(request: HttpRequest, integers?: IntegerMode): Promise<unknown>
  /**
   * A `fetch` for a generated SDK (hey-api): it reads the request's body once (so a second
   * attempt needs no clone), answers a status from 400 on as a Response, as the SDK expects, and
   * fails with an HttpFailure otherwise. It gets the URL the SDK's `Request` resolved already:
   * a path value `.` or `..` is gone by then (`/process-instance/../variables` reaches
   * `/variables`), so the path value rule runs before the URL is built, in the SDK's
   * `requestValidator` over its path values (`pathValueProblem`).
   */
  asFetch(options: AsFetchOptions): typeof fetch
}
