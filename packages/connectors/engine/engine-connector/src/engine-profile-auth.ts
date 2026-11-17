/**
 * What the server serves of a profile of each dialect, and how it signs in to the engine of a
 * profile it serves: the surface `refusalsOn` judges a profile on, its secret read from the
 * variable the profile (or the single engine) names, and the endpoints a credential must not go
 * to. The judge of engine-profiles.ts runs these; their sentences are engine-profile-words.ts's.
 */

import {
  type AuthType,
  authTypeOf,
  credentialsInClearText,
  type Dialect,
  type Profile,
  type Surface,
  tokenEndpointUrlProblem,
  type TokenEndpointUrlProblemCode,
} from "@miragon/pulse-profile"
import type { EngineAuth } from "./engine-provider.js"
import type { ClearTextProblem, SecretProblem } from "./engine-profile-words.js"

/** A token endpoint the client credentials grant cannot use, about the key that names it. */
interface TokenEndpointProblem {
  readonly code: TokenEndpointUrlProblemCode
  readonly key: "auth.tokenEndpoint"
}

/**
 * How this server signs in to an engine of each dialect: with nothing or Basic auth, on the
 * Camunda 7 REST API also with a bearer token or the caller's own token, on Camunda 8 with a token
 * of the client credentials grant. No OAuth login (no person is there to sign in), and no fixed
 * bearer token on Camunda 8.
 */
const SERVED_AUTH_TYPES: Readonly<Record<Dialect, readonly AuthType[]>> = {
  c7: ["none", "basic", "bearer", "passthrough"],
  c8: ["none", "basic", "clientCredentials"],
}

/**
 * What this server serves of a profile of `dialect`: its auth types, a REST root in every
 * profile, the default process engine only (no `/engine/{name}`), and no headers of its own.
 */
export function surfaceOf(dialect: Dialect): Surface {
  return {
    dialects: [dialect],
    authTypes: SERVED_AUTH_TYPES[dialect],
    urlRequired: true,
    defaultEngineOnly: true,
    refusedKeys: ["headers"],
  }
}

/**
 * The variable holding the password, the token and the client secret of a profile: its own, or
 * the single engine's (which names no client secret: it describes a Camunda 7 engine).
 */
export interface SecretSources {
  password(profile: Profile): string | undefined
  token(profile: Profile): string | undefined
  clientSecret(profile: Profile): string | undefined
}

export const FILE_SECRETS: SecretSources = {
  password: (profile) => profile.auth?.passwordEnv,
  token: (profile) => profile.auth?.tokenEnv,
  clientSecret: (profile) => profile.auth?.clientSecretEnv,
}

export const SINGLE_SECRETS: SecretSources = {
  password: () => "ENGINE_PASSWORD",
  token: () => "ENGINE_TOKEN",
  clientSecret: () => undefined,
}

/** The value of the variable `variable` names for `key`, or why there is none. */
function secretOf(
  key: SecretProblem["key"],
  variable: string | undefined,
  env: NodeJS.ProcessEnv,
): { readonly value?: string; readonly problems: SecretProblem[] } {
  if (variable === undefined) return { problems: [{ code: "secret-missing", key }] }
  const value = env[variable]
  return value === undefined || value === ""
    ? { problems: [{ code: "variable-unset", key, variable }] }
    : { value, problems: [] }
}

/** How the server signs in, or why it cannot: the problems, else the sign-in. */
export interface AuthRead {
  readonly auth?: EngineAuth
  readonly problems: readonly SecretProblem[]
}

/** `auth` when there is no problem, else the problems alone. */
const readOf = (problems: SecretProblem[], auth: () => EngineAuth): AuthRead =>
  problems.length > 0 ? { problems } : { auth: auth(), problems }

function basicAuth(profile: Profile, env: NodeJS.ProcessEnv, secrets: SecretSources): AuthRead {
  const username = profile.auth?.username
  const password = secretOf("auth.passwordEnv", secrets.password(profile), env)
  const problems: SecretProblem[] = [
    ...(username === undefined
      ? [{ code: "username-missing", key: "auth.username" } as const]
      : []),
    ...password.problems,
  ]
  return readOf(problems, () => ({ type: "basic", username, password: password.value }))
}

function bearerAuth(profile: Profile, env: NodeJS.ProcessEnv, secrets: SecretSources): AuthRead {
  const token = secretOf("auth.tokenEnv", secrets.token(profile), env)
  return readOf([...token.problems], () => ({ type: "bearer", token: token.value }))
}

/**
 * The client credentials grant: the token endpoint the format made sure of (`endpointProblems`
 * checked its URL), the client's ID, its secret from the variable auth.clientSecretEnv names,
 * and the audience and scopes as written.
 */
function clientCredentialsAuth(
  profile: Profile,
  env: NodeJS.ProcessEnv,
  secrets: SecretSources,
): AuthRead {
  const { tokenEndpoint = "", clientId, audience, scopes } = profile.auth ?? {}
  const secret = secretOf("auth.clientSecretEnv", secrets.clientSecret(profile), env)
  const problems: SecretProblem[] = [
    ...(clientId === undefined
      ? [{ code: "client-id-missing", key: "auth.clientId" } as const]
      : []),
    ...secret.problems,
  ]
  return readOf(problems, () => ({
    type: "clientCredentials",
    tokenEndpoint: tokenEndpoint.trim(),
    clientId,
    clientSecret: secret.value,
    ...(audience === undefined ? {} : { audience }),
    ...(scopes === undefined ? {} : { scopes }),
  }))
}

/** How the server signs in to the engine of `profile`, its secret read now; or why it cannot. */
export function authOf(profile: Profile, env: NodeJS.ProcessEnv, secrets: SecretSources): AuthRead {
  // refusalsOn turned away a type the profile's dialect is not served with, OAuth among them.
  const type = authTypeOf(profile) as EngineAuth["type"]
  if (type === "basic") return basicAuth(profile, env, secrets)
  if (type === "bearer") return bearerAuth(profile, env, secrets)
  if (type === "clientCredentials") return clientCredentialsAuth(profile, env, secrets)
  return { auth: { type }, problems: [] }
}

/**
 * Where the profile would send a credential it must not: a token endpoint the client credentials
 * grant cannot use, or, on Camunda 8, a credential over plain http beyond the loopback interface
 * (the cluster's `url` or the token endpoint, which gets the client secret). A Camunda 7 profile
 * keeps today's rule: its `url` in clear text is the operator's to decide.
 */
export function endpointProblems(
  profile: Profile,
  dialect: Dialect,
): (ClearTextProblem | TokenEndpointProblem)[] {
  const type = authTypeOf(profile)
  const problems: (ClearTextProblem | TokenEndpointProblem)[] =
    dialect !== "c7" && credentialsInClearText(profile.url ?? "", type)
      ? [{ code: "clear-text", key: "url" }]
      : []
  if (type !== "clientCredentials") return problems
  const tokenEndpoint = profile.auth?.tokenEndpoint ?? ""
  const code = tokenEndpointUrlProblem(tokenEndpoint)
  if (code !== undefined) return [...problems, { code, key: "auth.tokenEndpoint" }]
  return credentialsInClearText(tokenEndpoint, type)
    ? [...problems, { code: "clear-text", key: "auth.tokenEndpoint" }]
    : problems
}
