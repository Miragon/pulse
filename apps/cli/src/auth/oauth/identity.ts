/**
 * What a login is valid for (design §16.5): issuer, explicit token endpoint, client, audience and
 * the requested scopes. A cached login of another identity counts as not logged in; refreshes
 * and revocations only use the client secret of the current settings for a login of the same
 * identity, so a credential never crosses authorization servers or clients.
 */

import { ENV, type OAuthConfig } from '../../config/types.js';
import type { LoginIdentity } from './types.js';

/** The identity a login is valid for; scopes sorted and deduplicated. */
export function identityOf(config: OAuthConfig): LoginIdentity {
  const explicit = config.authorizationEndpoint !== undefined;
  return {
    issuer: config.issuer ?? null,
    tokenEndpoint: explicit ? (config.tokenEndpoint ?? null) : null,
    clientId: config.clientId,
    audience: config.audience ?? null,
    scopes: [...new Set(config.scopes)].sort(),
  };
}

export function sameIdentity(left: LoginIdentity, right: LoginIdentity): boolean {
  return (
    left.issuer === right.issuer &&
    left.tokenEndpoint === right.tokenEndpoint &&
    left.clientId === right.clientId &&
    left.audience === right.audience &&
    left.scopes.join(' ') === right.scopes.join(' ')
  );
}

/** One field in which a cached login differs from the configuration (never a secret). */
export interface IdentityDifference {
  /** `scopes "offline_access openid" (the configuration asks for "openid")`. */
  readonly text: string;
  /** The variable that set the configured value, when it came from the environment. */
  readonly variable?: string;
}

interface Field {
  readonly name: string;
  readonly value: (identity: LoginIdentity) => string | null;
  readonly variable: (config: OAuthConfig) => string | undefined;
}

const fromEnv = (source: string | undefined, variable: string) =>
  source === 'env' ? variable : undefined;

const FIELDS: readonly Field[] = [
  {
    name: 'issuer',
    value: (identity) => identity.issuer,
    variable: (config) => fromEnv(config.sources.endpoints, ENV.oauthIssuer),
  },
  {
    name: 'token endpoint',
    value: (identity) => identity.tokenEndpoint,
    variable: (config) => fromEnv(config.sources.endpoints, ENV.oauthTokenEndpoint),
  },
  {
    name: 'client',
    value: (identity) => identity.clientId,
    variable: (config) => fromEnv(config.sources.clientId, ENV.oauthClientId),
  },
  {
    name: 'audience',
    value: (identity) => identity.audience,
    variable: (config) => fromEnv(config.sources.audience, ENV.oauthAudience),
  },
  {
    name: 'scopes',
    value: (identity) => identity.scopes.join(' '),
    variable: (config) => fromEnv(config.sources.scopes, ENV.oauthScopes),
  },
];

function shown(value: string | null): string {
  return value === null ? 'none' : JSON.stringify(value);
}

/** The fields in which the login `stored` differs from the configuration, in schema order. */
export function identityDifferences(
  stored: LoginIdentity,
  config: OAuthConfig,
): IdentityDifference[] {
  const wanted = identityOf(config);
  return FIELDS.filter((field) => field.value(stored) !== field.value(wanted)).map((field) => {
    const text = `${field.name} ${shown(field.value(stored))} (the configuration asks for ${shown(field.value(wanted))})`;
    const variable = field.variable(config);
    return variable === undefined ? { text } : { text, variable };
  });
}
