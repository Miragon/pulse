/**
 * The provider variables (`MCP_OAUTH_*`) → the OAuth provider the boot installs. The server is a
 * resource server: it verifies the bearer token's signature, issuer, `exp`, `sub` and the RFC 8707
 * audience (`MCP_URL`'s origin plus `/mcp`) and serves discovery; it never mints tokens. It is the
 * ONLY caller-identity source, and it raises every module's no-suffix toolset to its standard set.
 * A gateway that terminates auth in front is invisible here: identity arrives only through this
 * OAuth.
 *
 * There is no provider selector, so the boot picks the one provider whose variables are set. Two
 * providers or an incomplete one fail the boot, naming the variables. Any other variable it does
 * not read (an `…_AUDIENCE`, a misspelled prefix) is the typo warner's, so a misspelled provider
 * boots without OAuth, and the log says so.
 */
import {
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthConvexProvider,
  oauthKeycloakProvider,
  oauthWorkOSProvider,
  type OAuthProvider,
  type ProviderOptions,
} from "./oauth-providers.js"

interface ProviderSpec {
  name: string
  /** Every one is required; the factory gets them explicitly, in this order. */
  variables: readonly string[]
  build(values: readonly string[], options: ProviderOptions): OAuthProvider
}

/**
 * The providers whose factory takes exactly these variables, verifies a JWT over issuer, JWKS and
 * the RFC 8707 resource, and maps the token's `sub` to `user.id` (what `callerUserId` reads).
 */
const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: "Keycloak",
    variables: ["MCP_OAUTH_KEYCLOAK_SERVER_URL", "MCP_OAUTH_KEYCLOAK_REALM"],
    build: ([serverUrl, realm], options) => oauthKeycloakProvider({ serverUrl, realm, ...options }),
  },
  {
    name: "Auth0",
    variables: ["MCP_OAUTH_AUTH0_DOMAIN"],
    build: ([domain], options) => oauthAuth0Provider({ domain, ...options }),
  },
  {
    name: "WorkOS",
    variables: ["MCP_OAUTH_WORKOS_SUBDOMAIN"],
    build: ([subdomain], options) => oauthWorkOSProvider({ subdomain, ...options }),
  },
  {
    name: "Better Auth",
    variables: ["MCP_OAUTH_BETTER_AUTH_URL"],
    build: ([authURL], options) => oauthBetterAuthProvider({ authURL, ...options }),
  },
  {
    name: "Convex",
    variables: ["MCP_OAUTH_CONVEX_AUTH_URL"],
    build: ([authURL], options) => oauthConvexProvider({ authURL, ...options }),
  },
]

/** The variables the boot reads for OAuth: every provider's, nothing else. */
export const OAUTH_ENV_VARS: readonly string[] = PROVIDERS.flatMap(({ variables }) => variables)

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
  values: string[]
}

/** The one provider the env asks for, or `undefined` for none; two or an incomplete one throw. */
function requestedProvider(env: NodeJS.ProcessEnv): Requested | undefined {
  const requested = PROVIDERS.map((provider) => ({
    provider,
    values: provider.variables.map((name) => valueOf(env, name)),
  })).filter(({ values }) => values.some(Boolean))
  if (requested.length > 1) {
    const described = requested.map(
      ({ provider, values }) =>
        `${provider.name} (${provider.variables.filter((_, i) => values[i]).join(", ")})`,
    )
    throw new Error(
      `OAuth variables of more than one provider are set: ${described.join(", ")}. Keep the variables of one provider and unset the others.`,
    )
  }
  if (requested.length === 0) return undefined
  const [{ provider, values }] = requested
  const missing = provider.variables.filter((_, i) => !values[i])
  if (missing.length > 0) {
    throw new Error(
      `${provider.name} OAuth needs ${provider.variables.join(" and ")}, but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} unset.`,
    )
  }
  return { provider, values: values as string[] }
}

function build({ provider, values }: Requested, options: ProviderOptions): OAuthProvider {
  try {
    return provider.build(values, options)
  } catch (error) {
    throw new Error(
      `${provider.name} OAuth (${provider.variables.join(", ")}) is invalid: ${(error as Error).message}`,
      { cause: error },
    )
  }
}

/**
 * No provider's variables → `undefined` plus ONE boot warning (prefixed with `label`). Two
 * providers, an incomplete or an invalid one throw. `MCP_OAUTH_DEBUG` is read from the same `env`.
 */
export function oauthFromEnv(env: NodeJS.ProcessEnv, label: string): OAuthProvider | undefined {
  const requested = requestedProvider(env)
  if (!requested) {
    console.warn(
      `[${label}] No OAuth provider is configured (MCP_OAUTH_*), so there is no caller identity: a module with toolsets runs its read-only floor unless MCP_ACTIVE_MODULES names a toolset, and a module without toolsets registers every tool. Set one provider's MCP_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).`,
    )
    return undefined
  }
  return build(requested, { debug: switchedOn(env[OAUTH_DEBUG_ENV_VAR]) })
}
