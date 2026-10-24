/**
 * Extra request headers (`-H`, OPERATE_HEADERS, profile headers): parsing, validation and
 * resolution. A value must be sendable by fetch (ISO-8859-1, no control characters but tab) and
 * connection management headers are refused, so that a bad header fails as CONFIG error naming it
 * instead of as a network error. Messages never repeat a value, it may be a credential.
 */

import { OperateError } from '../errors.js';
import { mergeHeaders } from '../util.js';
import { configError } from './config-error.js';
import type { Env } from './pick.js';
import { type ConfigFlags, ENV, type Profile, type Source } from './types.js';

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Control characters (line breaks, NUL, ESC, DEL, ...): not part of an HTTP field value. */
const HEADER_CONTROLS = /[^\P{Cc}\t]/u;
/** fetch only sends ISO-8859-1 header values; anything above U+00FF throws before the request. */
const BEYOND_LATIN1 = /[Ā-\u{10ffff}]/u;
/**
 * Connection management headers the HTTP client sets itself; undici refuses most of them (the
 * request would fail as if the engine were unreachable) and a wrong Content-Length breaks bodies.
 */
const CLIENT_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'expect',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);
const HEADER_HINT = 'Use the form "Name: value", e.g. "X-Tenant-Id: acme".';

/** True for a header name operate may send: an HTTP token, not a connection management header. */
export function isHeaderName(name: string): boolean {
  return HEADER_NAME.test(name) && !CLIENT_HEADERS.has(name.toLowerCase());
}

/** True for a value fetch can send: no control characters but tab, only ISO-8859-1. */
export function isHeaderValue(value: string): boolean {
  return !HEADER_CONTROLS.test(value) && !BEYOND_LATIN1.test(value);
}

function checkHeaderName(name: string): void {
  if (!HEADER_NAME.test(name)) throw configError(`Invalid header name "${name}"`, HEADER_HINT);
  if (CLIENT_HEADERS.has(name.toLowerCase())) {
    throw configError(
      `Header "${name}" cannot be set: the HTTP client manages it`,
      `Remove it. Not allowed: ${[...CLIENT_HEADERS].join(', ')}.`,
    );
  }
}

/** Checks a header value; messages never repeat it, it may be a credential. */
function checkHeaderValue(name: string, value: string): void {
  if (HEADER_CONTROLS.test(value)) {
    throw configError(
      `Invalid value for header "${name}": control characters (line breaks, NUL, ESC, DEL, ...) are not allowed`,
      HEADER_HINT,
    );
  }
  if (BEYOND_LATIN1.test(value)) {
    throw configError(
      `Invalid value for header "${name}": only ISO-8859-1 (Latin-1) characters are allowed`,
      'Encode other characters, e.g. with percent-encoding or Base64.',
    );
  }
}

/** Parses `Name: value`. Error messages never repeat the value, which may be a credential. */
export function parseHeader(header: string): [string, string] {
  const colon = header.indexOf(':');
  if (colon < 0) throw configError('Invalid header: expected "Name: value"', HEADER_HINT);
  const name = header.slice(0, colon).trim();
  const value = header.slice(colon + 1).trim();
  checkHeaderName(name);
  checkHeaderValue(name, value);
  return [name, value];
}

/** Parses `Name: value` headers into one map; later headers win (names are case-insensitive). */
export function parseHeaders(headers: readonly string[]): Record<string, string> {
  return mergeHeaders(
    ...headers.map((header) => {
      const [name, value] = parseHeader(header);
      return { [name]: value };
    }),
  );
}

/**
 * OPERATE_HEADERS: `Name: value` headers separated by line breaks (a header value never contains
 * one), e.g. an API key a CI job keeps in its environment instead of the command line.
 */
export function parseEnvHeaders(value: string | undefined): Record<string, string> {
  const lines = (value ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
  try {
    return parseHeaders(lines);
  } catch (error) {
    const reason = error instanceof OperateError ? error.message : String(error);
    throw configError(
      `Invalid ${ENV.headers}: ${reason}`,
      `Example: ${ENV.headers}='X-API-Key: <key>'; separate several headers with line breaks. A bearer token goes into ${ENV.token} (--auth bearer).`,
    );
  }
}

/**
 * The merged extra headers, the most specific source that contributed one, and the most specific
 * source of an `Authorization` header (Basic auth refuses to replace it).
 */
export interface ResolvedHeaders {
  readonly value: Record<string, string>;
  readonly source: Source;
  readonly authorization?: Source;
}

type Layer = readonly [Source, Readonly<Record<string, string>>];

/** True when the headers contain an `Authorization` header (names are case-insensitive). */
export function hasAuthorization(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
}

/** Headers merge per name: profile, then OPERATE_HEADERS, then -H flags (later wins). */
export function resolveHeaders(
  flags: ConfigFlags,
  env: Env,
  profile: Profile | undefined,
): ResolvedHeaders {
  const fromFlags = parseHeaders(flags.headers ?? []);
  const fromEnv = parseEnvHeaders(env[ENV.headers]);
  const fromProfile = profile?.headers ?? {};
  // most specific first
  const layers: readonly Layer[] = [
    ['flag', fromFlags],
    ['env', fromEnv],
    ['profile', fromProfile],
  ];
  const authorization = layers.find(([, headers]) => hasAuthorization(headers))?.[0];
  return {
    value: mergeHeaders(fromProfile, fromEnv, fromFlags),
    source: layers.find(([, headers]) => Object.keys(headers).length > 0)?.[0] ?? 'default',
    ...(authorization === undefined ? {} : { authorization }),
  };
}
