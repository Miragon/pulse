/**
 * The provider variables (`MCP_OAUTH_*`) → the OAuth provider the boot installs. The server is a
 * resource server: it verifies the bearer token's signature, issuer, `exp`, `sub` and the RFC 8707
 * audience (`MCP_URL`'s origin plus `/mcp`) and serves discovery; it never mints tokens. It is the
 * ONLY caller-identity source, and it raises every module's no-suffix toolset to its standard set.
 * A gateway that terminates auth in front is invisible here: identity arrives only through this
 * OAuth.
 *
 * There is no provider selector, so the boot picks the one provider whose variables are set. A
 * deployment that asked for auth never comes up without it: the retired JSON variable
 * (`MCP_OAUTH`), an OAuth variable this server does not read, two providers or an incomplete one
 * fail the boot, naming the variables. The names up to 0.27 (`MCP_USE_OAUTH_*`) are the boot's
 * retired table (`retired-boot-env.ts`), refused before this runs.
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
/** The retired JSON variable; its successors share its prefix, so only the exact name is refused. */
const RETIRED = "MCP_OAUTH"
/** The namespace an OAuth variable lives in; the former one (`MCP_USE_`) included. */
const MCP = "MCP_"
/** What names OAuth in a variable: the word, or a provider's segment (`KEYCLOAK`, `AUTH0`, …). */
const OAUTH_WORDS = ["OAUTH", ...new Set(OAUTH_ENV_VARS.map((name) => name.split("_")[2]))]
/**
 * The MCP Inspector's own OAuth settings (`pnpm dev` starts it from the same env): its namespace
 * and its client's callback URL. They configure the inspector as a client, never this server.
 */
const inspectorOwned = (name: string): boolean =>
  name.startsWith("MCP_INSPECTOR_") || name === "MCP_OAUTH_CALLBACK_URL"

const sortedList = (names: Iterable<string>): string => [...names].sort().join(", ")

/** "is"/"it" for one name, "are"/"them" for several. */
const grammar = (count: number) =>
  count === 1 ? { verb: "is", pronoun: "it" } : { verb: "are", pronoun: "them" }

const joinAlternatives = (items: readonly string[]): string =>
  `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`

const PROVIDER_LIST = joinAlternatives(
  PROVIDERS.map(({ name, variables }) => `${name} (${variables.join(", ")})`),
)

const presentNames = (env: NodeJS.ProcessEnv, matches: (name: string) => boolean): string[] =>
  Object.keys(env).filter((name) => env[name] !== undefined && matches(name))

/** A table variable counts as set only with a value; blank is unset. */
const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  env[name]?.trim() || undefined

/** Set to anything but blank, `0` or `false`. */
const switchedOn = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase()
  return Boolean(normalized) && normalized !== "0" && normalized !== "false"
}

function refuseRetired(env: NodeJS.ProcessEnv): void {
  if (env[RETIRED] === undefined) return
  throw new Error(
    `${RETIRED} is no longer read, so the server does not start without the OAuth it asks for. ` +
      `Unset it and set one provider's MCP_OAUTH_* variables instead: ` +
      `{"provider":"keycloak",…} becomes MCP_OAUTH_KEYCLOAK_SERVER_URL and MCP_OAUTH_KEYCLOAK_REALM, ` +
      `{"provider":"auth0",…} becomes MCP_OAUTH_AUTH0_DOMAIN.`,
  )
}

/**
 * An `MCP_*` name the boot does not read that asks for OAuth: any other `MCP_OAUTH_*` (an
 * `…_AUDIENCE`, a provider this server lacks), or one naming OAuth or a provider under a
 * misspelled prefix (`MCP_OAUH_KEYCLOAK_REALM`), which the typo warner would only warn about.
 */
function unread(name: string): boolean {
  if (!name.startsWith(MCP) || name === RETIRED || name === OAUTH_DEBUG_ENV_VAR) return false
  if (OAUTH_ENV_VARS.includes(name) || inspectorOwned(name)) return false
  const rest = name.slice(MCP.length)
  return OAUTH_WORDS.some((word) => rest.includes(word))
}

/** A blank value counts: the setting is there and would be ignored. */
function refuseUnread(env: NodeJS.ProcessEnv): void {
  const names = presentNames(env, unread)
  if (names.length === 0) return
  const { verb, pronoun } = grammar(names.length)
  throw new Error(
    `${sortedList(names)} ${verb} not read by this server, so it does not start. ` +
      `Unset ${pronoun}: the server reads one provider's variables, ${PROVIDER_LIST}, ` +
      `and takes the token audience from MCP_URL: tokens carry <MCP_URL>/mcp in aud (RFC 8707).`,
  )
}

/**
 * The refusals alone, which the boot runs before its typo warner: a variable it refuses fails the
 * boot as one line, without a warning about the same name in front of it.
 */
export function refuseOAuthEnv(env: NodeJS.ProcessEnv): void {
  refuseRetired(env)
  refuseUnread(env)
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
      `${provider.name} OAuth needs ${provider.variables.join(" and ")}, but ${missing.join(" and ")} ${grammar(missing.length).verb} unset.`,
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
 * No provider's variables → `undefined` plus ONE boot warning (prefixed with `label`). The retired
 * variable, a variable this server does not read, two providers, an incomplete or an invalid one
 * throw: a deployment that asked for auth must never come up without it. `MCP_OAUTH_DEBUG` is read
 * from the same `env`.
 */
export function oauthFromEnv(env: NodeJS.ProcessEnv, label: string): OAuthProvider | undefined {
  refuseOAuthEnv(env)
  const requested = requestedProvider(env)
  if (!requested) {
    console.warn(
      `[${label}] No OAuth provider is configured (MCP_OAUTH_*), so there is no caller identity: a module with toolsets runs its read-only floor unless MCP_ACTIVE_MODULES names a toolset, and a module without toolsets registers every tool. Set one provider's MCP_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).`,
    )
    return undefined
  }
  return build(requested, { debug: switchedOn(env[OAUTH_DEBUG_ENV_VAR]) })
}
