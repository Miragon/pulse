/**
 * Resolves the OAuth settings. The endpoint group (issuer, authorization and
 * token endpoint) comes as a unit from the most specific source that sets any of them
 * (environment over profile); every other value resolves on its own: environment > profile >
 * default. The client secret: OPERATE_OAUTH_CLIENT_SECRET > the variable named by
 * auth.clientSecretEnv > auth.clientSecret. Pure; messages never show a secret.
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
import { selectedLoginKey } from "./login-key.js"
import { type Env, nonEmpty } from "./pick.js"
import {
  type ConfigFlags,
  DEFAULT_OAUTH_SCOPES,
  ENV,
  type LoginKey,
  type OAuthConfig,
  type ProfileAuth,
  type SelectedProfile,
  type Source,
} from "./types.js"
import { CLIENT_SECRET_VARIABLE, unsetVariable } from "./variable.js"

export interface OAuthContext {
  readonly flags: ConfigFlags
  readonly env: Env
  readonly selected: SelectedProfile
}

/** A value with its source and where exactly it came from (`from OPERATE_OAUTH_ISSUER`). */
interface Found<T> {
  readonly value: T
  readonly source: Source
  readonly label: string
}

/** The issuer and endpoints of one source; both endpoints or neither. */
interface EndpointGroup {
  readonly issuer?: string
  readonly authorizationEndpoint?: string
  readonly tokenEndpoint?: string
  readonly source: Source
}

const ENDPOINT_KEYS = ["issuer", "authorizationEndpoint", "tokenEndpoint"] as const
type EndpointKey = (typeof ENDPOINT_KEYS)[number]

const ENDPOINT_ENV: Readonly<Record<EndpointKey, string>> = {
  issuer: ENV.oauthIssuer,
  authorizationEndpoint: ENV.oauthAuthorizationEndpoint,
  tokenEndpoint: ENV.oauthTokenEndpoint,
}

const ENDPOINT_KIND = {
  issuer: "issuer",
  authorizationEndpoint: "authorization endpoint",
  tokenEndpoint: "token endpoint",
} as const

/** The OPERATE_OAUTH_* variables, in the order messages name them. */
const OAUTH_ENV: readonly string[] = [
  ENV.oauthIssuer,
  ENV.oauthAuthorizationEndpoint,
  ENV.oauthTokenEndpoint,
  ENV.oauthClientId,
  ENV.oauthClientSecret,
  ENV.oauthScopes,
  ENV.oauthAudience,
  ENV.oauthRedirectPort,
]

const SET_HINT =
  "`operate config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>`"

/** A secret: blank counts as unset, other values are kept exactly. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value
}

function profileLabel(key: string, selected: SelectedProfile): string {
  return `auth.${key} of profile "${selected.name ?? ""}"`
}

/** Where a value of the endpoint group came from, for messages. */
function endpointLabel(key: EndpointKey, group: EndpointGroup, selected: SelectedProfile) {
  return group.source === "env" ? `from ${ENDPOINT_ENV[key]}` : profileLabel(key, selected)
}

/**
 * Where the issuer or endpoints of the resolved configuration came from, for the hints of
 * network errors (`OPERATE_OAUTH_ISSUER`, `auth.issuer of profile "p"`).
 */
export function endpointSource(config: OAuthConfig): string {
  const key = config.issuer === undefined ? "tokenEndpoint" : "issuer"
  return config.sources.endpoints === "env"
    ? ENDPOINT_ENV[key]
    : `auth.${key} of profile "${config.profile ?? ""}"`
}

type Endpoints = Partial<Record<EndpointKey, string>>

/** The values `read` gives for the group's keys, or undefined when it gives none. */
function groupOf(read: (key: EndpointKey) => string | undefined): Endpoints | undefined {
  const values: Endpoints = {}
  for (const key of ENDPOINT_KEYS) {
    const value = read(key)
    if (value !== undefined) values[key] = value
  }
  return Object.keys(values).length > 0 ? values : undefined
}

function rawGroup({ env, selected }: OAuthContext): EndpointGroup | undefined {
  const fromEnv = groupOf((key) => nonEmpty(env[ENDPOINT_ENV[key]]))
  if (fromEnv !== undefined) return { ...fromEnv, source: "env" }
  const auth: ProfileAuth = selected.profile?.auth ?? {}
  const fromProfile = groupOf((key) => nonEmpty(auth[key]))
  return fromProfile === undefined ? undefined : { ...fromProfile, source: "profile" }
}

/** The endpoint group, validated: URLs as validateOAuthUrl takes them, both endpoints or neither. */
function endpointGroup(context: OAuthContext): EndpointGroup | undefined {
  const group = rawGroup(context)
  if (group === undefined) return undefined
  const label = (key: EndpointKey) => endpointLabel(key, group, context.selected)
  if ((group.authorizationEndpoint === undefined) !== (group.tokenEndpoint === undefined)) {
    const given =
      group.authorizationEndpoint === undefined ? "tokenEndpoint" : "authorizationEndpoint"
    throw configError(
      `Only one OAuth endpoint is set (${label(given)})`,
      "Set both the authorization and the token endpoint, or neither and only the issuer (discovery).",
    )
  }
  const validated = groupOf((key) => {
    const value = group[key]
    return value === undefined ? undefined : validateOAuthUrl(value, ENDPOINT_KIND[key], label(key))
  })
  return { ...validated, source: group.source }
}

function fromEnvOrProfile(
  context: OAuthContext,
  variable: string,
  key: keyof ProfileAuth,
): Found<string> | undefined {
  const fromEnv = nonEmpty(context.env[variable])
  if (fromEnv !== undefined) return { value: fromEnv, source: "env", label: `from ${variable}` }
  const stored = context.selected.profile?.auth?.[key]
  const value = typeof stored === "string" ? nonEmpty(stored) : undefined
  return value === undefined
    ? undefined
    : { value, source: "profile", label: profileLabel(key, context.selected) }
}

/**
 * The variable named by auth.clientSecretEnv; it must be set. Its name is repeated only in the
 * usual form (`unsetVariable`): a secret typed in its place must not show up in the error.
 */
function secretFromVariable(variable: string, context: OAuthContext): Found<string> {
  const name = context.selected.name ?? ""
  const value = present(context.env[variable])
  if (value === undefined) throw unsetVariable(variable, name, CLIENT_SECRET_VARIABLE)
  return {
    value,
    source: "profile",
    label: `from ${variable}, auth.clientSecretEnv of profile "${name}"`,
  }
}

function pickSecret(context: OAuthContext): Found<string> | undefined {
  const fromEnv = present(context.env[ENV.oauthClientSecret])
  if (fromEnv !== undefined) {
    return { value: fromEnv, source: "env", label: `from ${ENV.oauthClientSecret}` }
  }
  const auth = context.selected.profile?.auth
  if (auth?.clientSecretEnv !== undefined) return secretFromVariable(auth.clientSecretEnv, context)
  const stored = present(auth?.clientSecret)
  return stored === undefined
    ? undefined
    : { value: stored, source: "profile", label: profileLabel("clientSecret", context.selected) }
}

function pickScopes(context: OAuthContext): Found<readonly string[]> {
  const fromEnv = nonEmpty(context.env[ENV.oauthScopes])
  if (fromEnv !== undefined) {
    return { value: parseScopes(fromEnv), source: "env", label: `from ${ENV.oauthScopes}` }
  }
  const stored = context.selected.profile?.auth?.scopes
  if (stored !== undefined) {
    return { value: stored, source: "profile", label: profileLabel("scopes", context.selected) }
  }
  return { value: DEFAULT_OAUTH_SCOPES, source: "default", label: "the default scopes" }
}

function pickRedirectPort(context: OAuthContext): Found<string | number> {
  const fromEnv = nonEmpty(context.env[ENV.oauthRedirectPort])
  if (fromEnv !== undefined) {
    return { value: fromEnv, source: "env", label: `from ${ENV.oauthRedirectPort}` }
  }
  const stored = context.selected.profile?.auth?.redirectPort
  return stored === undefined
    ? { value: 0, source: "default", label: "the default" }
    : { value: stored, source: "profile", label: profileLabel("redirectPort", context.selected) }
}

/** Where the issuer and the client id were looked up, for the error about missing values. */
function lookedUp(missing: readonly string[], selected: SelectedProfile): string {
  const profile = (keys: string) =>
    selected.profile === undefined
      ? "a profile (none is selected)"
      : `the ${keys} of profile "${selected.name}"`
  const places = {
    issuer: `the issuer in ${ENV.oauthIssuer}, ${ENV.oauthAuthorizationEndpoint} + ${ENV.oauthTokenEndpoint} and ${profile("auth.issuer / auth.authorizationEndpoint + auth.tokenEndpoint")}`,
    "client id": `the client id in ${ENV.oauthClientId} and ${profile("auth.clientId")}`,
  }
  return missing.map((value) => places[value as keyof typeof places]).join("; ")
}

function missingError(missing: readonly string[], selectedBy: string, context: OAuthContext) {
  const values = missing.map((value) => `the ${value}`).join(" and ")
  return configError(
    `OAuth is selected but ${values} ${missing.length > 1 ? "are" : "is"} missing`,
    `OAuth was selected by ${selectedBy}. Looked up ${lookedUp(missing, context.selected)}. Store them with ${SET_HINT}, or set the OPERATE_OAUTH_* variables; --auth none switches OAuth off.`,
  )
}

/** `--auth-password-stdin` with OAuth: stdin would be read for nothing. */
function refuseStdinPassword(context: OAuthContext, selectedBy: string): void {
  if (present(context.flags.authPassword) === undefined) return
  throw configError(
    `--auth-password-stdin reads a Basic auth password, but OAuth is selected by ${selectedBy}`,
    "Drop --auth-password-stdin: OAuth logs in with `operate auth login` and needs no password.",
  )
}

/** The endpoint group and the client id, or one CONFIG error naming everything missing. */
function required(context: OAuthContext, selectedBy: string) {
  const group = endpointGroup(context)
  const clientId = fromEnvOrProfile(context, ENV.oauthClientId, "clientId")
  const hasEndpoint = group?.issuer !== undefined || group?.tokenEndpoint !== undefined
  if (group !== undefined && hasEndpoint && clientId !== undefined) return { group, clientId }
  const missing = [hasEndpoint ? [] : ["issuer"], clientId === undefined ? ["client id"] : []]
  throw missingError(missing.flat(), selectedBy, context)
}

function validSecret(context: OAuthContext): Found<string> | undefined {
  const secret = pickSecret(context)
  return secret && { ...secret, value: validateClientSecret(secret.value, secret.label) }
}

function validAudience(context: OAuthContext): Found<string> | undefined {
  const audience = fromEnvOrProfile(context, ENV.oauthAudience, "audience")
  return audience && { ...audience, value: validateAudience(audience.value, audience.label) }
}

/** The login key of the selected profile; none without a profile. */
function loginOf(selected: SelectedProfile): LoginKey | undefined {
  return selected.name === undefined ? undefined : selectedLoginKey(selected)
}

/** The resolved OAuth settings; `selectedBy` names what selected OAuth (`--auth oauth`). */
export function resolveOAuth(context: OAuthContext, selectedBy: string): OAuthConfig {
  refuseStdinPassword(context, selectedBy)
  const { group, clientId } = required(context, selectedBy)
  const secret = validSecret(context)
  const audience = validAudience(context)
  const scopes = pickScopes(context)
  const port = pickRedirectPort(context)
  return {
    type: "oauth",
    ...compact({
      issuer: group.issuer,
      authorizationEndpoint: group.authorizationEndpoint,
      tokenEndpoint: group.tokenEndpoint,
      clientSecret: secret?.value,
      audience: audience?.value,
      profile: context.selected.name,
      login: loginOf(context.selected),
      projectDirectory: context.selected.project?.directory,
      configFile: context.selected.configFile,
    }),
    clientId: validateClientId(clientId.value, clientId.label),
    scopes: validateScopes(scopes.value, scopes.label),
    redirectPort: parseRedirectPort(port.value, port.label),
    sources: {
      endpoints: group.source,
      clientId: clientId.source,
      scopes: scopes.source,
      redirectPort: port.source,
      ...compact({ clientSecret: secret?.source, audience: audience?.source }),
    },
  }
}

/** The first OPERATE_OAUTH_* variable that is set, if any (names only, never values). */
export function oauthEnvVariable(env: Env): string | undefined {
  return OAUTH_ENV.find((variable) => nonEmpty(env[variable]) !== undefined)
}
