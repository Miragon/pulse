/**
 * Authentication seam. Every request passes through `headers()`; providers that can refresh
 * credentials (OAuth) return true from `refresh()` after a 401 so the client retries once.
 */

/** What `--dry-run` shows of a provider: the headers known without network access, and a note. */
export interface AuthPreview {
  readonly headers: Readonly<Record<string, string>>;
  /** Printed to stderr as `Note: <note>` by --dry-run, e.g. "not logged in". */
  readonly note?: string;
}

export interface AuthProvider {
  readonly type: string;
  headers(): Promise<Readonly<Record<string, string>>>;
  refresh?(): Promise<boolean>;
  /**
   * The headers `headers()` would add, for `--dry-run` previews, without network access, without
   * a refresh and without a lock (Basic: the header; OAuth: the cached token and a note).
   */
  preview?(): Promise<AuthPreview>;
  /**
   * Whose credentials are sent and where they came from, for hints and `ping`; never secrets.
   * OAuth knows it once the token cache was read.
   */
  readonly principal?: Principal | undefined;
  /**
   * Why no credentials are sent although some were configured (`Basic auth is switched off by
   * OPERATE_AUTH=none`, a password without a username), for the hint of a 401.
   */
  readonly off?: string;
  /**
   * The hint of a 401 or 403 answer to a request that carried this provider's credentials;
   * undefined keeps the generic hint (Basic keeps the principal text for 401 and the generic 403
   * text). OAuth answers both: a JWT gateway answers 403 for a wrong audience and 401 for a
   * missing, invalid, expired or foreign-issuer token.
   */
  rejectedHint?(status: number): string | undefined;
  /**
   * Appended to the hint of a 401 or 403 (and by `withAuthNote` to LOGIN_REQUIRED and the dry-run
   * note): a bearer token that is set but not used by this provider's auth type.
   */
  readonly note?: string;
  /**
   * The command that shows whether the login is usable, for the hint of a redirect (OAuth:
   * `operate auth status --profile p`).
   */
  readonly loginStatusCommand?: string;
}

export interface Principal {
  readonly user: string;
  /** `flag`, `env` or `profile`; `profile for the user, env for the password` when they differ. */
  readonly source: string;
}
