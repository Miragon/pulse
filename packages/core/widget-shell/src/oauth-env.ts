/**
 * mcp-use's own provider variables (`MCP_USE_OAUTH_*`) → the OAuth provider the boot installs.
 * mcp-use validates the bearer token and the RFC 8707 audience (`MCP_URL`) and serves discovery;
 * the server never mints tokens. It is the ONLY caller-identity source, and it raises every
 * module's no-suffix toolset to its standard set. A gateway that terminates auth in front is
 * invisible here: identity arrives only through this OAuth.
 *
 * mcp-use has no provider selector, so the boot picks the one provider whose variables are set.
 * A deployment that asked for auth never comes up without it: the retired JSON variable
 * (`MCP_OAUTH`), a variable this server does not read, two providers or an incomplete one fail
 * the boot, naming the variables.
 */
import type { OAuthProvider } from "mcp-use/oauth"
import { oauthAuth0Provider } from "mcp-use/oauth/auth0"
import { oauthBetterAuthProvider } from "mcp-use/oauth/better-auth"
import { oauthConvexProvider } from "mcp-use/oauth/convex"
import { oauthKeycloakProvider } from "mcp-use/oauth/keycloak"
import { oauthWorkOSProvider } from "mcp-use/oauth/workos"

/**
 * Since mcp-use 2.7 `setup(host)` makes `OAuthProvider<TUser>` invariant, so typed providers no
 * longer widen. Sound: every user went through the provider's `mapAuthInfo` and is read structurally.
 */
const withUnknownUser = <TUser>(provider: OAuthProvider<TUser>): OAuthProvider<unknown> =>
  provider as unknown as OAuthProvider<unknown>

interface ProviderSpec {
  name: string
  /** Every one is required; the factory gets them explicitly, in this order. */
  variables: readonly string[]
  build(values: readonly string[]): OAuthProvider<unknown>
}

/**
 * The providers whose factory takes exactly these variables, verifies a JWT over issuer, JWKS and
 * the RFC 8707 resource, and maps the token's `sub` to `user.id` (what `callerUserId` reads).
 */
const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: "Keycloak",
    variables: ["MCP_USE_OAUTH_KEYCLOAK_SERVER_URL", "MCP_USE_OAUTH_KEYCLOAK_REALM"],
    build: ([serverUrl, realm]) => withUnknownUser(oauthKeycloakProvider({ serverUrl, realm })),
  },
  {
    name: "Auth0",
    variables: ["MCP_USE_OAUTH_AUTH0_DOMAIN"],
    build: ([domain]) => withUnknownUser(oauthAuth0Provider({ domain })),
  },
  {
    name: "WorkOS",
    variables: ["MCP_USE_OAUTH_WORKOS_SUBDOMAIN"],
    build: ([subdomain]) => withUnknownUser(oauthWorkOSProvider({ subdomain })),
  },
  {
    name: "Better Auth",
    variables: ["MCP_USE_OAUTH_BETTER_AUTH_URL"],
    build: ([authURL]) => withUnknownUser(oauthBetterAuthProvider({ authURL })),
  },
  {
    name: "Convex",
    variables: ["MCP_USE_OAUTH_CONVEX_AUTH_URL"],
    build: ([authURL]) => withUnknownUser(oauthConvexProvider({ authURL })),
  },
]

/** The variables the boot reads for OAuth: every provider's, nothing else. */
export const OAUTH_ENV_VARS: readonly string[] = PROVIDERS.flatMap(({ variables }) => variables)

/** mcp-use's own switch for logging JWT verification failures; it changes no verdict. */
const DEBUG_VARIABLE = "MCP_USE_OAUTH_DEBUG"
/** The retired JSON variable and its look-alikes (the likeliest migration typo). */
const RETIRED = /^MCP_OAUTH(?:_|$)/
/** mcp-use's namespace, which the env typo warner leaves alone. */
const MCP_USE = "MCP_USE_"
/** What names OAuth in a variable: the word, or a provider's segment (`KEYCLOAK`, `AUTH0`, …). */
const OAUTH_WORDS = ["OAUTH", ...new Set(OAUTH_ENV_VARS.map((name) => name.split("_")[3]))]

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

function refuseRetired(env: NodeJS.ProcessEnv): void {
  const retired = presentNames(env, (name) => RETIRED.test(name))
  if (retired.length === 0) return
  const { verb, pronoun } = grammar(retired.length)
  throw new Error(
    `${sortedList(retired)} ${verb} no longer read, so the server does not start without the OAuth it asks for. ` +
      `Unset ${pronoun} and set one provider's MCP_USE_OAUTH_* variables instead: ` +
      `{"provider":"keycloak",…} becomes MCP_USE_OAUTH_KEYCLOAK_SERVER_URL and MCP_USE_OAUTH_KEYCLOAK_REALM, ` +
      `{"provider":"auth0",…} becomes MCP_USE_OAUTH_AUTH0_DOMAIN.`,
  )
}

/**
 * An `MCP_USE_*` name the boot does not read that asks for OAuth: any other `MCP_USE_OAUTH_*`, or
 * one naming OAuth or a provider under a misspelled prefix (`MCP_USE_OAUH_KEYCLOAK_REALM`), which
 * the typo warner never sees, since it leaves all of mcp-use's namespace alone.
 */
function unread(name: string): boolean {
  if (!name.startsWith(MCP_USE) || name === DEBUG_VARIABLE || OAUTH_ENV_VARS.includes(name)) {
    return false
  }
  const rest = name.slice(MCP_USE.length)
  return OAUTH_WORDS.some((word) => rest.includes(word))
}

/**
 * Reads `process.env` too: mcp-use's Keycloak and Auth0 factories read their `…_AUDIENCE` from
 * `process.env` whatever the code passes, so a root that hands the boot another `env` object
 * must not get a moved audience silently. A blank value counts: mcp-use would take it too.
 */
function refuseUnread(env: NodeJS.ProcessEnv): void {
  const names = new Set([...presentNames(env, unread), ...presentNames(process.env, unread)])
  if (names.size === 0) return
  const { verb, pronoun } = grammar(names.size)
  throw new Error(
    `${sortedList(names)} ${verb} not read by this server, so it does not start. ` +
      `Unset ${pronoun}: the server reads one provider's variables, ${PROVIDER_LIST}, ` +
      `and takes the token audience from MCP_URL (RFC 8707).`,
  )
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

function build({ provider, values }: Requested): OAuthProvider<unknown> {
  try {
    return provider.build(values)
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
 * throw: a deployment that asked for auth must never come up without it.
 */
export function oauthFromEnv(
  env: NodeJS.ProcessEnv,
  label: string,
): OAuthProvider<unknown> | undefined {
  refuseRetired(env)
  refuseUnread(env)
  const requested = requestedProvider(env)
  if (!requested) {
    console.warn(
      `[${label}] No OAuth provider is configured (MCP_USE_OAUTH_*), so there is no caller identity: modules without an explicit toolset run read-only. Set one provider's MCP_USE_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).`,
    )
    return undefined
  }
  return build(requested)
}
