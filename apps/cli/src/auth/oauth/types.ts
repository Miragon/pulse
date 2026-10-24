/** Types of the OAuth authorization code flow with PKCE (design §16). Types only. */

import type { TraceEvent } from '../../http/types.js';
import type { FileSystem, OutputStream, Runtime } from '../../runtime.js';

/** What every OAuth operation needs from the outside world; `clientOf` builds it per command. */
export interface OAuthDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly fs: FileSystem;
  readonly now: () => number;
  readonly withLock: Runtime['withLock'];
  /** The token cache directory (`tokenDirectory`), created before the lock is taken. */
  readonly tokenDir: string;
  /** A file of the token directory (`tokenPath` bound to the directory and platform). */
  readonly tokenPath: (fileName: string) => string;
  /** The resolved `--timeout`: bounds every discovery, token and revocation request. */
  readonly timeoutMs: number;
  /** `--verbose`: token requests are traced like engine requests (bodies never). */
  readonly trace?: (event: TraceEvent) => void;
}

/** Only `operate auth login` gets these: it alone may start a loopback server or a browser. */
export interface LoginDeps extends OAuthDeps {
  readonly randomBytes: Runtime['randomBytes'];
  readonly listenLoopback: Runtime['listenLoopback'];
  readonly openBrowser: Runtime['openBrowser'];
  readonly deadline: Runtime['deadline'];
  readonly stderr: OutputStream;
}

/** How a confidential client authenticates at the token endpoint (RFC 6749 §2.3.1). */
export type ClientAuthMethod = 'client_secret_basic' | 'client_secret_post';

/**
 * How the client of a login authenticated (RFC 7591 `token_endpoint_auth_method` names): `none`
 * for a public client, else the method of the confidential client.
 */
export type LoginClientAuth = 'none' | ClientAuthMethod;

/** The authorization server as operate uses it: discovered or configured endpoints. */
export interface ServerMetadata {
  /** The discovered issuer, or the configured one with explicit endpoints (null: none known). */
  readonly issuer: string | null;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string | null;
  /** RFC 9207: the callback must carry `iss`. */
  readonly issParameterRequired: boolean;
  readonly clientAuthMethod: ClientAuthMethod;
}

/** A validated token endpoint answer. */
export interface TokenResponse {
  readonly accessToken: string;
  /** Seconds, or null when unknown. */
  readonly expiresIn: number | null;
  readonly refreshToken: string | null;
  /** Seconds (Keycloak's `refresh_expires_in`), or null when unknown. */
  readonly refreshExpiresIn: number | null;
  readonly scope: string | null;
  /** `sub` of the ID token (display only). */
  readonly subject: string | null;
  /** `preferred_username`, else `email` of the ID token (display only). */
  readonly user: string | null;
}

/** What a login is valid for; a cache of another identity counts as not logged in. */
export interface LoginIdentity {
  readonly issuer: string | null;
  /** The configured explicit token endpoint; null with discovery. */
  readonly tokenEndpoint: string | null;
  readonly clientId: string;
  readonly audience: string | null;
  /** Requested scopes, sorted and deduplicated. */
  readonly scopes: readonly string[];
}

/** The token cache file (schema version 1, design §16.5). */
export interface CachedLogin {
  readonly version: 1;
  readonly identity: LoginIdentity;
  readonly endpoints: {
    readonly token: string;
    readonly revocation: string | null;
    /**
     * `none`: a public client; logout then never sends a client secret. A confidential login is
     * refreshed and revoked with its method, and only with the secret of the same identity.
     */
    readonly clientAuthMethod: LoginClientAuth;
  };
  readonly tokenType: string;
  readonly accessToken: string;
  /** Epoch ms, or null when unknown. */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  readonly refreshExpiresAt: number | null;
  readonly scope: string | null;
  readonly subject: string | null;
  readonly user: string | null;
  readonly loggedInAt: number;
  readonly refreshedAt: number | null;
  /**
   * Written when the authorization server refused the refresh token (`invalid_grant` and the
   * other grant errors): commands and `auth status` then know that a new login is needed
   * without another request. A new login replaces the file without it.
   */
  readonly refreshRejected?: { readonly at: number; readonly error: string };
}
