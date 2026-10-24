/**
 * Validation of the OAuth settings (design §16.2): issuer and endpoint URLs, client id and
 * secret, scopes, audience, redirect port, and the OAuth rules for a profile's auth object in the
 * config file. Messages name where a value came from (`label`) and never repeat a secret.
 */

import { isRecord } from '../util.js';
import { configError } from './config-error.js';
import { redactUrl } from './redact.js';
import { CONTROL, ENV_NAME, isNonEmptyString } from './syntax.js';
import { AUTH_TYPES, BASIC_AUTH_KEYS, OAUTH_AUTH_KEYS, type ProfileAuth } from './types.js';

/** RFC 6749 VSCHAR: printable ASCII (client id, audience). */
const VSCHAR = /^[\x20-\x7e]+$/;
/** RFC 6749 §3.3 scope-token: printable ASCII except space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const PORT = /^\d+$/;
const MAX_PORT = 65_535;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '[::1]']);
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export const ISSUER_EXAMPLE = 'https://login.example.com/realms/camunda';

/** What an OAuth URL is, for messages. */
export type OAuthUrlKind = 'issuer' | 'authorization endpoint' | 'token endpoint';

/** True for a host on the loopback interface (local test identity providers may use http). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || LOOPBACK_V4.test(hostname);
}

/**
 * The `host:port` of an engine URL that would carry a Bearer token over plain http beyond the
 * loopback interface (RFC 6750 §5.3 requires TLS), else undefined.
 */
export function plainHttpHost(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname) ? parsed.host : undefined;
}

function parseOAuthUrl(url: string, kind: OAuthUrlKind, label: string): URL {
  try {
    return new URL(url);
  } catch {
    throw configError(
      `Invalid OAuth ${kind} "${redactUrl(url)}" (${label})`,
      `Use an absolute URL, e.g. ${ISSUER_EXAMPLE} for the issuer.`,
    );
  }
}

/** Why an absolute OAuth URL is not acceptable, or undefined. */
function urlProblem(parsed: URL, kind: OAuthUrlKind): string | undefined {
  if (parsed.username !== '' || parsed.password !== '') return 'must not contain credentials';
  const secure =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  if (!secure) return 'must use https:// (http:// only for localhost, 127.0.0.1 or [::1])';
  if (parsed.hash !== '' || parsed.href.endsWith('#')) return 'must not contain a fragment';
  return kind === 'issuer' && parsed.search !== '' ? 'must not contain a query' : undefined;
}

/**
 * Checks an issuer or endpoint URL: absolute, https (http only for a loopback host), no user
 * info, no fragment, the issuer also no query (RFC 8414 §2). Returns it trimmed, otherwise exactly
 * as given: the issuer is compared character by character (Auth0 issuers end with "/").
 */
export function validateOAuthUrl(url: string, kind: OAuthUrlKind, label: string): string {
  const trimmed = url.trim();
  const problem = urlProblem(parseOAuthUrl(trimmed, kind, label), kind);
  if (problem === undefined) return trimmed;
  throw configError(
    `The OAuth ${kind} (${label}) ${problem}, got "${redactUrl(trimmed)}"`,
    `Example issuer: ${ISSUER_EXAMPLE}. Local test identity providers may use http://localhost.`,
  );
}

/** Checks a client id (RFC 6749 VSCHAR, not blank) and trims it. */
export function validateClientId(clientId: string, label: string): string {
  const trimmed = clientId.trim();
  if (trimmed === '' || !VSCHAR.test(trimmed)) {
    throw configError(
      `The OAuth client id (${label}) must be printable ASCII and not empty`,
      'Use the client id registered at the authorization server, e.g. operate-cli.',
    );
  }
  return trimmed;
}

/** Checks a client secret without repeating it: no control characters. Never trimmed. */
export function validateClientSecret(secret: string, label: string): string {
  if (CONTROL.test(secret)) {
    throw configError(
      `The OAuth client secret (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      'Copy the secret again from the authorization server; it is a single line.',
    );
  }
  return secret;
}

/** Splits a scope list given as text: separated by spaces and/or commas. */
export function parseScopes(text: string): string[] {
  return text.split(/[\s,]+/).filter((scope) => scope !== '');
}

/** Checks scopes: RFC 6749 scope-tokens without duplicates. */
export function validateScopes(scopes: readonly string[], label: string): string[] {
  const invalid = scopes.find((scope) => !SCOPE_TOKEN.test(scope));
  if (invalid !== undefined) {
    throw configError(
      `Invalid OAuth scope "${invalid}" (${label})`,
      'Scopes are printable ASCII without spaces, quotes or backslashes, e.g. "openid offline_access".',
    );
  }
  const duplicate = scopes.find((scope, index) => scopes.indexOf(scope) !== index);
  if (duplicate !== undefined) {
    throw configError(`The OAuth scope "${duplicate}" is listed twice (${label})`);
  }
  return [...scopes];
}

/** Checks an audience (RFC 6749 VSCHAR, not blank) and trims it. */
export function validateAudience(audience: string, label: string): string {
  const trimmed = audience.trim();
  if (trimmed === '' || !VSCHAR.test(trimmed)) {
    throw configError(
      `The OAuth audience (${label}) must be printable ASCII and not empty`,
      'Example: engine-rest. Without an audience (the authorization server sets it itself, e.g. a Keycloak audience mapper) remove it: `operate config unset <profile> audience`, or unset OPERATE_OAUTH_AUDIENCE.',
    );
  }
  return trimmed;
}

/** True for a port of the login callback: 0 (any free port) to 65535. */
function isRedirectPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PORT;
}

/** Parses the port of the login callback; 0 means any free port. */
export function parseRedirectPort(value: string | number, label: string): number {
  const port = typeof value === 'string' && PORT.test(value.trim()) ? Number(value) : value;
  if (!isRedirectPort(port)) {
    throw configError(
      `The OAuth redirect port (${label}) must be a whole number between 0 and ${MAX_PORT}, got "${value}"`,
      'Use 0 (any free port) unless the authorization server only accepts a fixed registered port.',
    );
  }
  return port;
}

type Check = readonly [check: (value: unknown) => boolean, expected: string];

function isScopeList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === 'string' && SCOPE_TOKEN.test(scope)) &&
    new Set(value).size === value.length
  );
}

const URL_CHECK: Check = [isNonEmptyString, 'a URL such as https://login.example.com/realms/x'];

/** Shape checks of the OAuth keys in the config file (URL details are checked on resolution). */
export const OAUTH_CHECKS: Readonly<Record<(typeof OAUTH_AUTH_KEYS)[number], Check>> = {
  issuer: URL_CHECK,
  authorizationEndpoint: URL_CHECK,
  tokenEndpoint: URL_CHECK,
  clientId: [isNonEmptyString, 'a non-empty string'],
  clientSecretEnv: [
    (value) => typeof value === 'string' && ENV_NAME.test(value),
    'the name of an environment variable, e.g. OPERATE_CLIENT_SECRET',
  ],
  clientSecret: [isNonEmptyString, 'a non-empty string'],
  scopes: [isScopeList, 'an array of distinct scopes such as ["openid", "offline_access"]'],
  audience: [isNonEmptyString, 'a non-empty string'],
  redirectPort: [isRedirectPort, 'a whole number between 0 and 65535'],
};

function keysOf(value: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => Object.hasOwn(value, key));
}

/** The type rule: OAuth keys need oauth or none, Basic keys basic, none or no type. */
function typeProblem(name: string, type: unknown, basic: string[], oauth: string[]) {
  const [family, keys, wanted, allowed] =
    oauth.length > 0
      ? (['OAuth', oauth, 'oauth', ['oauth', 'none']] as const)
      : (['Basic auth', basic, 'basic', ['basic', 'none', undefined]] as const);
  if (keys.length === 0 || (allowed as readonly unknown[]).includes(type)) return undefined;
  // unknown types are reported by resolution, which names the supported ones
  if (type !== undefined && !(AUTH_TYPES as readonly unknown[]).includes(type)) return undefined;
  const actual = type === undefined ? 'is not set' : `is ${type as string}`;
  return `profile "${name}" has ${family} keys (${keys.join(', ')}) but its auth.type ${actual}; set "type": "${wanted}"`;
}

/**
 * The OAuth rules for the auth object of profile `name` in the config file (after the per-key
 * shape checks): no Basic and OAuth keys together, the type rule, one client secret source, both
 * endpoints or neither. Never quotes values.
 */
export function oauthProfileProblem(name: string, value: Record<string, unknown>) {
  const basic = keysOf(value, BASIC_AUTH_KEYS);
  const oauth = keysOf(value, OAUTH_AUTH_KEYS);
  if (basic.length > 0 && oauth.length > 0) {
    return `profile "${name}" mixes Basic auth keys (${basic.join(', ')}) and OAuth keys (${oauth.join(', ')}); keep one`;
  }
  const problem = typeProblem(name, value.type, basic, oauth);
  if (problem !== undefined) return problem;
  if (Object.hasOwn(value, 'clientSecret') && Object.hasOwn(value, 'clientSecretEnv')) {
    return `profile "${name}" sets both auth.clientSecret and auth.clientSecretEnv; keep one (clientSecretEnv is recommended)`;
  }
  const endpoints = keysOf(value, ['authorizationEndpoint', 'tokenEndpoint']);
  return endpoints.length === 1
    ? `profile "${name}" sets auth.${endpoints[0] ?? ''} without the other endpoint; set both auth.authorizationEndpoint and auth.tokenEndpoint, or neither (discovery from auth.issuer)`
    : undefined;
}

/** True when the stored auth object has OAuth settings. */
export function hasOAuthKeys(auth: ProfileAuth | undefined): boolean {
  return isRecord(auth) && OAUTH_AUTH_KEYS.some((key) => Object.hasOwn(auth, key));
}
