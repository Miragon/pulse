/**
 * The provider variables (`MCP_OAUTH_*`) → the OAuth provider the boot installs. The server is a
 * resource server: it verifies the bearer token's signature, issuer, `exp`, the caller claim and
 * the RFC 8707 audience (`MCP_URL`'s origin plus `/mcp`) and serves discovery; it never mints
 * tokens. It is the ONLY caller-identity source, and it raises every module's no-suffix toolset to
 * its standard set. A gateway that terminates auth in front is invisible here: identity arrives
 * only through this OAuth.
 *
 * There is no provider selector, so the boot picks the one provider whose variables are set: one of
 * the table's, the generic OpenID Connect provider (`MCP_OAUTH_OIDC_*`, oauth-oidc.ts) or Microsoft
 * Entra ID for one tenant (`MCP_OAUTH_ENTRA_*`, oauth-entra.ts). Two
 * providers, a provider without a required variable or an invalid one fail the boot, naming the
 * variables. A variable it does not read (a misspelled prefix) is the typo warner's, so a
 * misspelled provider boots without OAuth, and the log says so.
 */
import { ENTRA_ENV, oauthEntraProvider, readEntraSettings } from "./oauth-entra.js"
import { OIDC_ENV, oauthOidcProvider, readOidcSettings } from "./oauth-oidc.js"
import {
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthConvexProvider,
  oauthKeycloakProvider,
  oauthWorkOSProvider,
  type OAuthProvider,
  type ProviderOptions,
} from "./oauth-providers.js"

/** What a provider's factory gets besides its variables. */
interface ProviderContext {
  readonly options: ProviderOptions
  /** `MCP_WEB_CLIENT_ID`, the web sign-in's client, when set. */
  readonly webClientId: string | undefined
  /** One line of the boot's log, under its name. */
  readonly log: (line: string) => void
}

interface ProviderSpec {
  name: string
  /** Each is required once any variable of the provider is set; the factory gets them in order. */
  required: readonly string[]
  /** The variables it may take besides, by the factory's names; a blank one is unset. */
  optional?: Readonly<Record<string, string>>
  build(
    required: readonly string[],
    optional: Readonly<Record<string, string | undefined>>,
    context: ProviderContext,
  ): OAuthProvider
}

const { issuer: OIDC_ISSUER, ...OIDC_OPTIONAL } = OIDC_ENV
const { tenantId: ENTRA_TENANT_ID, apiClientId: ENTRA_API_CLIENT_ID, ...ENTRA_OPTIONAL } = ENTRA_ENV

/**
 * The providers: the table's, whose factory takes exactly their required variables, verifies a JWT
 * over issuer, JWKS and the RFC 8707 resource, and maps the token's `sub` to `user.id` (what
 * `callerUserId` reads), the generic OpenID Connect provider, whose optional variables name its
 * audiences, scopes, caller claim, algorithms and clients, and Entra ID, whose tenant and API name
 * its issuers, audiences and scope.
 */
const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: "Keycloak",
    required: ["MCP_OAUTH_KEYCLOAK_SERVER_URL", "MCP_OAUTH_KEYCLOAK_REALM"],
    build: ([serverUrl, realm], _, { options }) =>
      oauthKeycloakProvider({ serverUrl, realm, ...options }),
  },
  {
    name: "Auth0",
    required: ["MCP_OAUTH_AUTH0_DOMAIN"],
    build: ([domain], _, { options }) => oauthAuth0Provider({ domain, ...options }),
  },
  {
    name: "WorkOS",
    required: ["MCP_OAUTH_WORKOS_SUBDOMAIN"],
    build: ([subdomain], _, { options }) => oauthWorkOSProvider({ subdomain, ...options }),
  },
  {
    name: "Better Auth",
    required: ["MCP_OAUTH_BETTER_AUTH_URL"],
    build: ([authURL], _, { options }) => oauthBetterAuthProvider({ authURL, ...options }),
  },
  {
    name: "Convex",
    required: ["MCP_OAUTH_CONVEX_AUTH_URL"],
    build: ([authURL], _, { options }) => oauthConvexProvider({ authURL, ...options }),
  },
  {
    name: "OpenID Connect",
    required: [OIDC_ISSUER],
    optional: OIDC_OPTIONAL,
    build: ([issuer], optional, { options, webClientId, log }) =>
      oauthOidcProvider(readOidcSettings(issuer, optional, webClientId), { ...options, log }),
  },
  {
    name: "Entra ID",
    required: [ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID],
    optional: ENTRA_OPTIONAL,
    build: ([tenantId, apiClientId], optional, { options, webClientId }) =>
      oauthEntraProvider(readEntraSettings(tenantId, apiClientId, optional, webClientId), options),
  },
]

/** Every variable of a provider: the required ones, then the optional ones. */
const variablesOf = ({ required, optional = {} }: ProviderSpec): string[] => [
  ...required,
  ...Object.values<string>(optional),
]

/** The variables the boot reads for OAuth: every provider's, nothing else. */
export const OAUTH_ENV_VARS: readonly string[] = PROVIDERS.flatMap(variablesOf)

/** Logs why a bearer token was refused (never the token); it changes no verdict. */
export const OAUTH_DEBUG_ENV_VAR = "MCP_OAUTH_DEBUG"

/** A table variable counts as set only with a value; blank is unset. */
const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  env[name]?.trim() || undefined

/** Set to anything but blank, `0` or `false`. */
const switchedOn = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase()
  return Boolean(normalized) && normalized !== "0" && normalized !== "false"
}

interface Requested {
  provider: ProviderSpec
  /** The provider's variables the env sets, in the provider's order. */
  set: string[]
}

const isOrAre = (names: readonly string[]): string => (names.length === 1 ? "is" : "are")

/** Why the provider cannot be built without a required variable, naming what is set instead. */
function incomplete({ provider, set }: Requested, missing: readonly string[]): Error {
  const needs = `${provider.name} OAuth needs ${provider.required.join(" and ")}`
  if (missing.length < provider.required.length) {
    return new Error(`${needs}, but ${missing.join(" and ")} ${isOrAre(missing)} unset.`)
  }
  return new Error(
    `${needs}, which ${isOrAre(missing)} unset while ${set.join(" and ")} ${isOrAre(set)} set.`,
  )
}

/** The one provider the env asks for, or `undefined` for none; two or an incomplete one throw. */
function requestedProvider(env: NodeJS.ProcessEnv): Requested | undefined {
  const requested = PROVIDERS.map((provider) => ({
    provider,
    set: variablesOf(provider).filter((name) => valueOf(env, name) !== undefined),
  })).filter(({ set }) => set.length > 0)
  if (requested.length > 1) {
    const described = requested.map(({ provider, set }) => `${provider.name} (${set.join(", ")})`)
    throw new Error(
      `OAuth variables of more than one provider are set: ${described.join(", ")}. Keep the variables of one provider and unset the others.`,
    )
  }
  if (requested.length === 0) return undefined
  const [first] = requested
  const missing = first.provider.required.filter((name) => !first.set.includes(name))
  if (missing.length > 0) throw incomplete(first, missing)
  return first
}

function build(
  { provider, set }: Requested,
  env: NodeJS.ProcessEnv,
  context: ProviderContext,
): OAuthProvider {
  const required = provider.required.map((name) => String(valueOf(env, name)))
  const optional = Object.fromEntries(
    Object.entries<string>(provider.optional ?? {}).map(([key, name]) => [key, valueOf(env, name)]),
  )
  try {
    return provider.build(required, optional, context)
  } catch (error) {
    throw new Error(
      `${provider.name} OAuth (${set.join(", ")}) is invalid: ${(error as Error).message}`,
      { cause: error },
    )
  }
}

/**
 * No provider's variables → `undefined` plus ONE boot warning (prefixed with `label`). Two
 * providers, an incomplete or an invalid one throw. `MCP_OAUTH_DEBUG` is read from the same `env`,
 * and so is `MCP_WEB_CLIENT_ID`, which joins the generic or the Entra ID provider's client allowlist.
 */
export function oauthFromEnv(env: NodeJS.ProcessEnv, label: string): OAuthProvider | undefined {
  const requested = requestedProvider(env)
  if (!requested) {
    console.warn(
      `[${label}] No OAuth provider is configured (MCP_OAUTH_*), so there is no caller identity: a module with toolsets runs its read-only floor unless MCP_ACTIVE_MODULES names a toolset, and a module without toolsets registers every tool. Set one provider's MCP_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).`,
    )
    return undefined
  }
  return build(requested, env, {
    options: { debug: switchedOn(env[OAUTH_DEBUG_ENV_VAR]) },
    webClientId: valueOf(env, "MCP_WEB_CLIENT_ID"),
    log: (line) => console.warn(`[${label}] ${line}`),
  })
}
