/** Outcome of executing an operation, consumed by the output layer. Types only. */

/** The request as sent (or as it would be sent with --dry-run). */
export interface RequestPreview {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body, or a preview of the multipart parts. */
  readonly body?: unknown;
}

/** One part of a multipart body in a request preview. */
export type MultipartPartPreview =
  | { readonly name: string; readonly value: string }
  | { readonly name: string; readonly fileName: string; readonly bytes: number };

export type OperationResult =
  | {
      readonly kind: 'dry-run';
      readonly request: RequestPreview;
      /** Printed to stderr as `Note: <note>`, e.g. that the OAuth login is missing. */
      readonly note?: string;
    }
  | {
      readonly kind: 'json';
      readonly status: number;
      readonly value: unknown;
      /** The response body as received (absent for the combined pages of `--all`). */
      readonly text?: string;
      readonly request: RequestPreview;
    }
  | {
      readonly kind: 'text';
      readonly status: number;
      readonly text: string;
      readonly contentType: string;
      readonly request: RequestPreview;
    }
  | {
      readonly kind: 'binary';
      readonly status: number;
      readonly data: Uint8Array;
      readonly contentType: string;
      readonly request: RequestPreview;
    }
  | {
      readonly kind: 'none';
      readonly status: number;
      readonly statusText: string;
      readonly request: RequestPreview;
    };
