/**
 * The server's own words about its engine profiles, beside the profile format's
 * (`describeProblem` of @miragon/pulse-profile, which engine-profiles.ts applies): what this
 * server cannot serve of a profile of each dialect, a token endpoint it cannot use, a credential
 * it would send in clear text, a key the model does not read the name of, a secret the server
 * cannot read or send, the two forms a list of engines took up to 0.27, and the single engine's
 * settings by the variable that sets each. No sentence repeats a value.
 */

import type { Dialect, ProblemCode } from "@miragon/pulse-profile"
import type { CredentialProblem } from "./lib/engine/credentials.js"

/** How the server signs in to an engine of each dialect, as a refusal of another auth.type says. */
const SIGNS_IN: Readonly<Record<Dialect, string>> = {
  c7: "This server cannot sign in with this auth.type: it signs in with none, basic, bearer or passthrough, and an OAuth login needs a person.",
  c8: "This server cannot sign in to a Camunda 8 engine with this auth.type: it signs in with none, basic or clientCredentials, whose tokens it gets itself.",
}

/** The REST root of each dialect, as a missing `url` names it. */
const REST_ROOTS: Readonly<Record<Dialect, string>> = {
  c7: "http://localhost:8080/engine-rest",
  c8: "http://localhost:8080/v2",
}

/**
 * What this server cannot serve, in its own words, by the format's problem code (the codes of
 * `refusalsOn` but the dialect's, since the server reads every dialect of the format): the
 * format's sentences speak of "this client", which the model would read as its own MCP client.
 * `key` is the key the problem is about, `dialect` the profile's.
 */
export const NOT_SERVED: Readonly<
  Record<string, (key: string | undefined, dialect: Dialect) => string>
> = {
  "auth-type-not-served": (_key, dialect) => SIGNS_IN[dialect],
  "url-missing": (_key, dialect) =>
    `url is missing: this server needs the REST API root, a URL such as ${REST_ROOTS[dialect]}.`,
  "process-engine-not-served": () =>
    'engine names a process engine this server does not reach: it reaches only "default".',
  "key-not-served": (key) =>
    `This server does not apply ${key ?? "a key of the profile"}, so it refuses the profile rather than ignore it.`,
}

/**
 * A token endpoint the client credentials grant cannot use, where the format's sentence would
 * point elsewhere (its URL example is a REST root's, its credentials go into auth); the codes of
 * `tokenEndpointUrlProblem` it words alike are the format's.
 */
const TOKEN_ENDPOINT: Readonly<Partial<Record<ProblemCode, string>>> = {
  "url-invalid":
    "auth.tokenEndpoint is no URL: use the URL that issues tokens, such as https://login.example.com/oauth/token.",
  "url-credentials":
    "auth.tokenEndpoint must not contain credentials (they are not shown): the server sends the client's ID and secret itself.",
}

/** The server's sentence of a problem of the token endpoint, or undefined for the format's. */
export function tokenEndpointSentence(code: ProblemCode): string | undefined {
  return TOKEN_ENDPOINT[code]
}

/**
 * A Camunda 8 profile that would send a credential over plain http beyond the loopback interface:
 * its `url` (the cluster gets the credential) or its token endpoint (which gets the client
 * secret). Refused, since nothing on the way may read it (RFC 6750 §5.3, RFC 7617 §4).
 */
export interface ClearTextProblem {
  readonly code: "clear-text"
  readonly key: "url" | "auth.tokenEndpoint"
}

export function isClearTextProblem(problem: {
  readonly code: string
}): problem is ClearTextProblem {
  return problem.code === "clear-text"
}

/** Why a credential would travel in clear text, about the key it goes to; never the URL. */
export const CLEAR_TEXT: Readonly<Record<ClearTextProblem["key"], string>> = {
  url: "url is plain http:// to a host beyond this machine, so the cluster's credentials would travel unencrypted: use https://.",
  "auth.tokenEndpoint":
    "auth.tokenEndpoint is plain http:// to a host beyond this machine, so the client secret would travel unencrypted: use https://.",
}

/** A key the format does not know, in `parent` (`auth`) or the profile, without its name. */
export function unnamedKeySentence(parent: string | undefined): string {
  return `${parent ?? "The profile"} holds a key the profile format does not know (it is not shown).`
}

/**
 * A secret the server cannot use: its user name or variable missing, the variable unset, or a
 * value the credential cannot carry (`credential`, a line break inside a token, say).
 */
export interface SecretProblem {
  readonly code:
    "username-missing" | "client-id-missing" | "secret-missing" | "variable-unset" | "unsendable"
  readonly key:
    | "auth.username"
    | "auth.passwordEnv"
    | "auth.tokenEnv"
    | "auth.clientId"
    | "auth.clientSecretEnv"
  readonly variable?: string
  readonly credential?: CredentialProblem
}

const SECRET_CODES: ReadonlySet<string> = new Set([
  "username-missing",
  "client-id-missing",
  "secret-missing",
  "variable-unset",
  "unsendable",
])

export function isSecretProblem(problem: { readonly code: string }): problem is SecretProblem {
  return SECRET_CODES.has(problem.code)
}

/** The key a credential that cannot be sent is about. */
export const UNSENDABLE_KEYS: Readonly<Record<CredentialProblem, SecretProblem["key"]>> = {
  "user-colon": "auth.username",
  "control-character": "auth.passwordEnv",
  "token-syntax": "auth.tokenEnv",
}

/** Why a credential cannot be sent, about the key it comes from; never the value. */
const UNSENDABLE: Readonly<Record<CredentialProblem, string>> = {
  "user-colon": "auth.username holds a colon, which Basic auth (RFC 7617) cannot carry.",
  "control-character":
    "The password auth.passwordEnv names holds a control character (a line break, say), which Basic auth (RFC 7617) cannot carry; the value is not shown.",
  "token-syntax":
    "The token auth.tokenEnv names holds a character no bearer token (RFC 6750) carries, a line break inside it, say (one at its end is trimmed); the value is not shown.",
}

/**
 * The sentence of a secret problem of a profile. `shown` is its variable when the reader may see
 * it (the operator, a name in its conventional form), else undefined: the model never reads one.
 */
export function secretSentence(problem: SecretProblem, shown: string | undefined): string {
  const { code, key, credential } = problem
  if (credential !== undefined) return UNSENDABLE[credential]
  if (code === "username-missing") return `${key} is missing: Basic auth needs a user name.`
  if (code === "client-id-missing") {
    return `${key} is missing: the client credentials grant needs the client's ID.`
  }
  if (code === "secret-missing") {
    return `${key} is missing: the server reads the secret from the variable it names.`
  }
  return shown === undefined
    ? `${key} names a variable that is not set.`
    : `${key} names ${shown}, which is not set.`
}

const PROFILE_FILE_SHAPE =
  '{"defaultProfile": "<name>", "profiles": {"<id>": {"url": "…", "flavor": "…", "environment": "…", "auth": {…}}}}'

const ENTRY_TO_PROFILE =
  "An entry's id becomes its key and baseUrl becomes url. A secret leaves the JSON: auth.password becomes auth.passwordEnv and auth.token becomes auth.tokenEnv, each naming the variable that holds it, a name that starts with ENGINE_SECRET_."

/** The two forms a list of engines took up to 0.27, each with what it becomes. */
export const OLD_FORMS = {
  array: (where: string) =>
    `${where} holds a JSON array, the form up to 0.27. It now holds one profile file: ${PROFILE_FILE_SHAPE}. ${ENTRY_TO_PROFILE}`,
  map: (where: string) =>
    `${where} holds an environment map, the form up to 0.27: each key becomes "environment" on its profiles. It now holds one profile file: ${PROFILE_FILE_SHAPE}. ${ENTRY_TO_PROFILE}`,
}

/** `docker run --env-file` keeps the quotes around a value, so the JSON arrives wrapped in them. */
export function parseHint(text: string): string {
  return /^['"]/.test(text)
    ? "It starts with a quote: remove the quotes around the JSON, since some env files keep them."
    : "Look for a trailing comma or a missing quote, for example."
}

/** The variable behind each key of the single engine's profile. */
export const SINGLE_KEYS: Readonly<Record<string, string>> = {
  url: "ENGINE_BASE_URL",
  cockpitUrl: "ENGINE_COCKPIT_URL",
  flavor: "ENGINE_FLAVOR",
  "auth.type": "ENGINE_AUTH_TYPE",
  "auth.username": "ENGINE_USERNAME",
}

/** Why a credential of the single engine cannot be sent, naming its variables; never the value. */
const SINGLE_UNSENDABLE: Readonly<Record<CredentialProblem, string>> = {
  "user-colon": "ENGINE_USERNAME holds a colon, which Basic auth (RFC 7617) cannot carry.",
  "control-character":
    "ENGINE_USERNAME or ENGINE_PASSWORD holds a control character (a line break, say), which Basic auth (RFC 7617) cannot carry; the value is not shown.",
  "token-syntax":
    "ENGINE_TOKEN holds a character no bearer token (RFC 6750) carries, a line break inside it, say (one at its end is trimmed); the value is not shown.",
}

const BASIC_NEEDS =
  "ENGINE_AUTH_TYPE=basic needs ENGINE_USERNAME and ENGINE_PASSWORD; otherwise engine requests would run unauthenticated."

/**
 * The secrets the single engine reads; the client credentials grant's it never reaches, since its
 * variables describe a Camunda 7 engine (`singleDialectSentence`).
 */
const SINGLE_SECRET_SENTENCES: Readonly<Partial<Record<SecretProblem["key"], string>>> = {
  "auth.username": BASIC_NEEDS,
  "auth.passwordEnv": BASIC_NEEDS,
  "auth.tokenEnv":
    "ENGINE_AUTH_TYPE=bearer needs ENGINE_TOKEN; otherwise engine requests would run unauthenticated.",
}

/** The sentence of a secret problem of the single engine, naming the variables to set. */
export function singleSecretSentence(problem: SecretProblem): string {
  if (problem.credential !== undefined) return SINGLE_UNSENDABLE[problem.credential]
  return SINGLE_SECRET_SENTENCES[problem.key] ?? secretSentence(problem, undefined)
}

/**
 * ENGINE_FLAVOR names `flavor`, a flavor of another dialect than the Camunda 7 REST API's: the
 * single engine's variables describe a Camunda 7 engine, and such an engine is a profile.
 */
export function singleDialectSentence(flavor: string): string {
  return (
    `ENGINE_FLAVOR=${flavor}: ENGINE_BASE_URL and its siblings describe a Camunda 7 engine. ` +
    `A ${flavor} engine is a profile in ENGINES_JSON or ENGINES_FILE, for example ` +
    `{"profiles": {"<id>": {"url": "https://<cluster>/v2", "flavor": "${flavor}", "auth": ` +
    '{"type": "clientCredentials", "tokenEndpoint": "…", "clientId": "…", "clientSecretEnv": ' +
    '"ENGINE_SECRET_<NAME>"}}}}.'
  )
}
