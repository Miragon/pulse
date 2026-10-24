/** Transport level request and response types. */

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | FormData;
}

export interface HttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** Structured trace of one HTTP exchange; the CLI formats and masks it for `--verbose`. */
export type TraceEvent =
  | {
      readonly type: 'request';
      readonly method: string;
      readonly url: string;
      /** Final headers as sent, including the auth headers (unmasked). */
      readonly headers: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'response';
      readonly status: number;
      readonly statusText: string;
      /** Time from sending the request until the body was read completely. */
      readonly durationMs: number;
      /** Size of the response body. */
      readonly bytes: number;
    }
  | {
      /**
       * A decision without an answer of its own, printed as `* <message>` (like `curl -v`): e.g. a
       * failed token refresh after which the still valid token is used.
       */
      readonly type: 'note';
      readonly message: string;
    };
