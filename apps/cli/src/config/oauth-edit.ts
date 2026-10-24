/**
 * `operate config set` changes of a profile's OAuth settings: only given values
 * change; `--oauth-issuer` alone goes back to discovery (stored endpoints are removed), the two
 * endpoint options come together and keep the issuer (the `iss` check), the client secret is
 * stored as the name of a variable (recommended) or literally. Values are validated with the
 * resolve validators.
 */

import { compact } from "../util.js"
import { configError } from "./config-error.js"
import {
  parseRedirectPort,
  parseScopes,
  validateAudience,
  validateClientId,
  validateClientSecret,
  validateOAuthUrl,
  validateScopes,
} from "./oauth.js"
import { type OAUTH_AUTH_KEYS, type ProfileAuth } from "./types.js"
import { CLIENT_SECRET_VARIABLE, validateVariableName } from "./variable.js"

export interface OAuthChanges {
  readonly oauthIssuer?: string
  readonly oauthAuthorizationEndpoint?: string
  readonly oauthTokenEndpoint?: string
  readonly oauthClientId?: string
  /** Name of the variable holding the client secret; replaces a stored clientSecret. */
  readonly oauthClientSecretEnv?: string
  /** Literal client secret from stdin (discouraged); replaces a stored clientSecretEnv. */
  readonly oauthClientSecret?: string
  /** Scopes separated by spaces and/or commas; `''` stores no scopes. */
  readonly oauthScopes?: string
  readonly oauthAudience?: string
  readonly oauthRedirectPort?: string | number
}

const OAUTH_OPTIONS = [
  "oauthIssuer",
  "oauthAuthorizationEndpoint",
  "oauthTokenEndpoint",
  "oauthClientId",
  "oauthClientSecretEnv",
  "oauthClientSecret",
  "oauthScopes",
  "oauthAudience",
  "oauthRedirectPort",
] as const satisfies readonly (keyof OAuthChanges)[]

type Endpoints = Pick<ProfileAuth, "issuer" | "authorizationEndpoint" | "tokenEndpoint">
type Secret = Pick<ProfileAuth, "clientSecret" | "clientSecretEnv">

/** True when any OAuth option was given. */
export function hasOAuthOptions(changes: OAuthChanges): boolean {
  return OAUTH_OPTIONS.some((key) => changes[key] !== undefined)
}

function ifGiven<T, R>(value: T | undefined, convert: (value: T) => R): R | undefined {
  return value === undefined ? undefined : convert(value)
}

function issuerOf(changes: OAuthChanges): string | undefined {
  return ifGiven(changes.oauthIssuer, (issuer) =>
    validateOAuthUrl(issuer, "issuer", "from --oauth-issuer"),
  )
}

function endpointsOf(existing: ProfileAuth | undefined, changes: OAuthChanges): Endpoints {
  const { oauthAuthorizationEndpoint: authorization, oauthTokenEndpoint: token } = changes
  if ((authorization === undefined) !== (token === undefined)) {
    throw configError(
      "--oauth-authorization-endpoint and --oauth-token-endpoint must be given together",
      "Give both endpoints, or only --oauth-issuer to discover them.",
    )
  }
  const issuer = issuerOf(changes) ?? existing?.issuer
  if (authorization !== undefined && token !== undefined) {
    return compact({
      issuer,
      authorizationEndpoint: validateOAuthUrl(
        authorization,
        "authorization endpoint",
        "from --oauth-authorization-endpoint",
      ),
      tokenEndpoint: validateOAuthUrl(token, "token endpoint", "from --oauth-token-endpoint"),
    })
  }
  // a new issuer alone means discovery: stored endpoints would bypass it
  if (changes.oauthIssuer !== undefined) return compact({ issuer })
  return compact({
    issuer,
    authorizationEndpoint: existing?.authorizationEndpoint,
    tokenEndpoint: existing?.tokenEndpoint,
  })
}

function secretOf(existing: ProfileAuth | undefined, changes: OAuthChanges): Secret {
  const { oauthClientSecretEnv: variable, oauthClientSecret: secret } = changes
  if (variable !== undefined && secret !== undefined) {
    throw configError(
      "--oauth-client-secret-env and --oauth-client-secret-stdin exclude each other",
      "Store the name of the environment variable that holds the client secret (recommended), or the secret itself.",
    )
  }
  if (variable !== undefined) {
    return { clientSecretEnv: validateVariableName(variable, CLIENT_SECRET_VARIABLE) }
  }
  if (secret !== undefined) {
    return { clientSecret: validateClientSecret(secret, "from --oauth-client-secret-stdin") }
  }
  return compact({
    clientSecretEnv: existing?.clientSecretEnv,
    clientSecret: existing?.clientSecret,
  })
}

/** The OAuth keys of the changed auth object: stored values, overridden by the given options. */
export function changedOAuthKeys(
  existing: ProfileAuth | undefined,
  changes: OAuthChanges,
): Partial<ProfileAuth> {
  return {
    ...endpointsOf(existing, changes),
    ...compact({
      clientId:
        ifGiven(changes.oauthClientId, (id) => validateClientId(id, "from --oauth-client-id")) ??
        existing?.clientId,
      scopes:
        ifGiven(changes.oauthScopes, (scopes) =>
          validateScopes(parseScopes(scopes), "from --oauth-scopes"),
        ) ?? existing?.scopes,
      audience:
        ifGiven(changes.oauthAudience, (audience) =>
          validateAudience(audience, "from --oauth-audience"),
        ) ?? existing?.audience,
      redirectPort:
        ifGiven(changes.oauthRedirectPort, (port) =>
          parseRedirectPort(port, "from --oauth-redirect-port"),
        ) ?? existing?.redirectPort,
    }),
    ...secretOf(existing, changes),
  }
}

type OAuthKey = (typeof OAUTH_AUTH_KEYS)[number]

const ENDPOINT_PAIR: readonly OAuthKey[] = ["authorizationEndpoint", "tokenEndpoint"]
const SECRET_KEYS: readonly OAuthKey[] = ["clientSecret", "clientSecretEnv"]

/**
 * The OAuth keys `operate config unset <profile> <key>` accepts, and what each removes from the
 * auth object: the endpoints go as a pair (both or neither), the client secret in either form.
 */
const UNSET_KEYS: Readonly<Record<string, readonly OAuthKey[]>> = {
  issuer: ["issuer"],
  endpoints: ENDPOINT_PAIR,
  authorizationEndpoint: ENDPOINT_PAIR,
  tokenEndpoint: ENDPOINT_PAIR,
  clientId: ["clientId"],
  clientSecret: SECRET_KEYS,
  clientSecretEnv: SECRET_KEYS,
  scopes: ["scopes"],
  audience: ["audience"],
  redirectPort: ["redirectPort"],
}

/** The OAuth key names of `config unset`, for help texts and hints. */
export const OAUTH_UNSET_KEYS: readonly string[] = [
  "issuer",
  "endpoints",
  "clientId",
  "clientSecret",
  "scopes",
  "audience",
  "redirectPort",
]

/** The auth keys an OAuth key name of `config unset` removes (`auth.` prefix allowed), if any. */
export function oauthUnsetKeys(key: string): readonly OAuthKey[] | undefined {
  const bare = key.startsWith("auth.") ? key.slice("auth.".length) : key
  return Object.hasOwn(UNSET_KEYS, bare) ? UNSET_KEYS[bare] : undefined
}

/** The auth object without `keys`; undefined when nothing is left. */
export function withoutAuthKeys(
  auth: ProfileAuth | undefined,
  keys: readonly (keyof ProfileAuth)[],
): ProfileAuth | undefined {
  if (auth === undefined) return undefined
  const kept = Object.fromEntries(
    Object.entries(auth).filter(([key]) => !(keys as readonly string[]).includes(key)),
  )
  return Object.keys(kept).length > 0 ? kept : undefined
}
