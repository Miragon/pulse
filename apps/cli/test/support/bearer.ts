/**
 * Bearer token fixtures for unit tests (design §18): arbitrary RFC 6750 b64tokens and JWTs with
 * the given claims (unsigned: operate never checks signatures).
 */

import fc from 'fast-check';

/** RFC 6750 b64token characters. */
const TOKEN_CHARS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  '-',
  '.',
  '_',
  '~',
  '+',
  '/',
];

const parts = fc.tuple(
  fc.string({ unit: fc.constantFrom(...TOKEN_CHARS), minLength: 1, maxLength: 40 }),
  fc.string({ unit: fc.constant('='), maxLength: 2 }),
);

/** Valid b64tokens: at least one token character, then optional "=" padding. */
export const b64tokens = parts.map(([body, padding]) => `${body}${padding}`);

/** Distinctive valid opaque tokens that never occur in an output by chance. */
export const opaqueTokens = parts.map(([body, padding]) => `Tk9${body}Zq7${padding}`);

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** A JWT with the given claims; the signature is any base64url text. */
export function jwtWith(claims: Readonly<Record<string, unknown>>, signature = 'c2ln'): string {
  return `${base64Url('{"alg":"RS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.${signature}`;
}

/** The fake runtime's clock (2023-11-14T22:13:20.000Z), in epoch seconds. */
export const NOW_S = 1_700_000_000;

/** Claims of a token issued for the engine that is valid for another hour. */
export const VALID_CLAIMS = {
  sub: '27c6dbd7-a170-4b19-8686-f7299949346a',
  preferred_username: 'alice',
  iss: 'https://login.example.com/realms/camunda',
  aud: ['engine-rest', 'account'],
  exp: NOW_S + 3600,
} as const;
