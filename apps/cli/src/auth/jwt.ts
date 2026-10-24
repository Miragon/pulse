/**
 * Reading the claims of a JWT (RFC 7519) without checking its signature (design §18): bearer
 * tokens from elsewhere are often JWTs, and their expiry, subject, issuer and audience help
 * explain a rejected or expired token. Nothing here decides whether a token is trusted; the
 * engine or its gateway does that. Opaque tokens give no claims.
 */

import { isRecord } from '../util.js';

/** How far `exp` may lie in the past before a token counts as expired (clock skew). */
export const EXPIRY_SKEW_MS = 30_000;

/** Longest claim value shown. */
const MAX_CLAIM = 200;

/** Largest epoch ms a Date can represent. */
const MAX_DATE_MS = 8.64e15;

/** A base64url segment of a compact JWS (no padding). */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export interface JwtClaims {
  /** `exp` in epoch ms, null without a usable `exp`. */
  readonly expiresAt: number | null;
  readonly subject: string | null;
  /** `preferred_username`. */
  readonly user: string | null;
  readonly issuer: string | null;
  /** `aud` as a list (a single string becomes one entry). */
  readonly audience: readonly string[];
}

/** base64url → UTF-8 text; throws on invalid input. */
export function decodeBase64Url(segment: string): string {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

/** A JSON object encoded in a base64url segment, else undefined. */
function jsonSegment(segment: string): Record<string, unknown> | undefined {
  if (!SEGMENT.test(segment)) return undefined;
  try {
    const value: unknown = JSON.parse(decodeBase64Url(segment));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A claim for display: a string without control characters, shortened. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\p{Cc}/gu, '');
  if (clean === '') return null;
  return clean.length > MAX_CLAIM ? `${clean.slice(0, MAX_CLAIM)}…` : clean;
}

function expiryOf(exp: unknown): number | null {
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  const ms = exp * 1000;
  return Math.abs(ms) <= MAX_DATE_MS ? ms : null;
}

function audienceOf(aud: unknown): string[] {
  const values: unknown[] = Array.isArray(aud) ? aud : [aud];
  return values.flatMap((value) => {
    const shown = text(value);
    return shown === null ? [] : [shown];
  });
}

/**
 * The claims of a JWT: three dot-separated parts whose first two are base64url encoded JSON
 * objects (header and payload). Undefined for anything else (opaque tokens, JWE).
 */
export function jwtClaims(token: string): JwtClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header = '', payload = ''] = parts;
  const claims = jsonSegment(payload);
  if (jsonSegment(header) === undefined || claims === undefined) return undefined;
  return {
    expiresAt: expiryOf(claims.exp),
    subject: text(claims.sub),
    user: text(claims.preferred_username),
    issuer: text(claims.iss),
    audience: audienceOf(claims.aud),
  };
}

/** True once `exp` lies more than EXPIRY_SKEW_MS in the past; never without an `exp`. */
export function isExpired(claims: Pick<JwtClaims, 'expiresAt'>, now: number): boolean {
  return claims.expiresAt !== null && now - claims.expiresAt > EXPIRY_SKEW_MS;
}
