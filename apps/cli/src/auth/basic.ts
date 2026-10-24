/**
 * HTTP Basic authentication (RFC 7617): `Authorization: Basic base64(utf8(username:password))`.
 * The header needs no network access, so dry-run previews show it (masked unless --show-secrets).
 */

import type { BasicAuthConfig } from '../config/types.js';
import type { AuthProvider } from './types.js';

const encoder = new TextEncoder();

/** Standard Base64 of the UTF-8 encoding of `text` (also for OAuth client credentials). */
export function base64(text: string): string {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The Authorization header value for the credentials. */
export function basicHeader(username: string, password: string): string {
  return `Basic ${base64(`${username}:${password}`)}`;
}

/** `env`, or `profile for the user, env for the password` when the two differ. */
export function credentialSource(sources: BasicAuthConfig['sources']): string {
  return sources.username === sources.password
    ? sources.username
    : `${sources.username} for the user, ${sources.password} for the password`;
}

export function basicAuth(config: BasicAuthConfig): AuthProvider {
  const headers = { Authorization: basicHeader(config.username, config.password) };
  return {
    type: 'basic',
    headers: () => Promise.resolve(headers),
    preview: () => Promise.resolve({ headers }),
    principal: { user: config.username, source: credentialSource(config.sources) },
  };
}
