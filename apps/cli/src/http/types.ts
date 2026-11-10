/** Transport level request and response types of the CLI, over @miragon/pulse-http's. */

import type { Intent } from "@miragon/pulse-http"

export interface HttpRequest {
  readonly method: string
  readonly url: string
  /**
   * Whether the request only reads: the effect of its catalog operation (a POST that queries
   * reads), never guessed from the method.
   */
  readonly intent: Intent
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string | FormData
}

/** An answer of the engine; from status 400 on with the request's secrets masked. */
export interface HttpResponse {
  readonly status: number
  readonly statusText: string
  readonly contentType: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array<ArrayBuffer>
}

/** Structured trace of one HTTP exchange; the CLI formats it for `--verbose`. */
export type TraceEvent =
  | {
      readonly type: "request"
      readonly method: string
      readonly url: string
      /**
       * The headers as sent, in their senders' spelling. An engine request's come from
       * @miragon/pulse-http, its secret headers masked unless `--show-secrets` asked for them; a
       * token request's from the OAuth client, the client credentials always masked.
       */
      readonly headers: Readonly<Record<string, string>>
    }
  | {
      readonly type: "response"
      readonly status: number
      readonly statusText: string
      /** Time from sending the request until the body was read completely. */
      readonly durationMs: number
      /** Size of the response body as received; none for a redirect, whose body is never read. */
      readonly bytes?: number
    }
  | {
      /**
       * A decision without an answer of its own, printed as `* <message>` (like `curl -v`): e.g. a
       * failed token refresh after which the still valid token is used.
       */
      readonly type: "note"
      readonly message: string
    }
