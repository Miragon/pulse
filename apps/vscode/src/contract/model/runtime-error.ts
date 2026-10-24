export type RuntimeFailure =
  | 'unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'misconfigured'
  | 'engineFailure'
  | 'unexpectedResponse'
  | 'rejected';

export interface RuntimeErrorOptions {
  readonly hint?: string;
  readonly cause?: unknown;
}

export class RuntimeError extends Error {
  override readonly name = 'RuntimeError';
  readonly hint: string | undefined;

  constructor(
    readonly failure: RuntimeFailure,
    message: string,
    options: RuntimeErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.hint = options.hint;
  }

  static is(error: unknown): error is RuntimeError {
    return error instanceof RuntimeError;
  }
}
