/**
 * One English sentence per problem, for a log, a boot warning or an editor's problem list. It
 * names the key, never a value of the file, nor a profile name: the reader puts its own context
 * in front (the file, the profile) and its own way out behind (a flag, a variable, a command).
 */

import { MAX_TIMEOUT_MS } from "./profile.js"
import {
  AUTH_TYPES,
  FLAVORS,
  OUTPUT_FORMATS,
  type Problem,
  type ProblemCode,
  SECRET_VARIABLE_PREFIX,
} from "./types.js"

const NAME_RULE = 'letters, digits, ".", "_" and "-", starting with a letter or digit'
const VARIABLE = `the name of an environment variable, such as ${SECRET_VARIABLE_PREFIX}PROD_PASSWORD`
const NON_EMPTY = "a non-empty string"
const LINK = "a URL such as http://localhost:8080/engine-rest"

/** What each key takes, for a problem `invalid`. */
const EXPECTED: Readonly<Record<string, string>> = {
  $schema: "a string, the URL or path of a JSON Schema",
  defaultProfile: "a string that names one of the file's profiles",
  url: LINK,
  cockpitUrl: "a URL such as http://localhost:8080/camunda/app/cockpit/default/",
  engine: 'the name of a process engine, not "." or ".."',
  flavor: `a string, one of ${Object.keys(FLAVORS).join(", ")}`,
  environment:
    'an environment id: lower case letters, digits and "-", starting with a letter or digit',
  auth: 'an object such as {"type": "basic", "username": "demo"}',
  output: OUTPUT_FORMATS.join(" or "),
  timeout: `a whole number of milliseconds between 1 and ${String(MAX_TIMEOUT_MS)}`,
  headers:
    "an object that maps header names (HTTP tokens, not Connection, Content-Length, Expect, Keep-Alive, Transfer-Encoding or Upgrade) to ISO-8859-1 (Latin-1) values without control characters but tab",
  readOnly: "true or false",
  "auth.type": `a string, one of ${AUTH_TYPES.join(", ")}`,
  "auth.username": 'a non-empty string without ":" and without control characters',
  "auth.passwordEnv": VARIABLE,
  "auth.password": NON_EMPTY,
  "auth.issuer": "a URL such as https://login.example.com/realms/engine",
  "auth.authorizationEndpoint": "a URL",
  "auth.tokenEndpoint": "a URL",
  "auth.clientId": NON_EMPTY,
  "auth.clientSecretEnv": VARIABLE,
  "auth.clientSecret": NON_EMPTY,
  "auth.scopes": 'a list of distinct scopes such as ["openid", "offline_access"]',
  "auth.audience": NON_EMPTY,
  "auth.redirectPort": "a whole number between 0 and 65535",
  "auth.tokenEnv": VARIABLE,
  "auth.token": NON_EMPTY,
}

const subject = (problem: Problem) => problem.key ?? "A key that is not shown"

/** What `key` takes; only the keys EXPECTED lists, never a name the prototype answers to. */
const expected = (key: string): string =>
  (Object.hasOwn(EXPECTED, key) ? EXPECTED[key] : undefined) ?? "of another kind"

/**
 * A key twice. JSON keeps only the last value of a key; a header name counts twice in any
 * spelling, since HTTP ignores its case. A key that is not shown may be either.
 */
function twice({ key }: Problem): string {
  if (key === undefined) return "A key that is not shown is set twice: set it once."
  return key.startsWith("headers.")
    ? `${key} is set twice, in one spelling or two (header names ignore case): set it once.`
    : `${key} is set twice, and JSON keeps only the last one without a word: set it once.`
}

/** The sentence of each code; `key` is the problem's key (or what stands for it). */
const SENTENCES: Readonly<Record<ProblemCode, (problem: Problem) => string>> = {
  "not-json": ({ line, column }) =>
    line === undefined
      ? "The text is not valid JSON."
      : `The text is not valid JSON (line ${String(line)}, column ${String(column)}).`,
  "root-not-object": () => "The file must hold one JSON object.",
  "profiles-not-object": () =>
    "profiles must be a JSON object that maps each profile name to a profile.",
  "duplicate-key": twice,
  "unknown-root-key": (problem) =>
    `${subject(problem)} is no key of a profile file, which holds $schema, defaultProfile and profiles.`,
  "default-not-found": () => "defaultProfile names no profile of this file.",
  invalid: (problem) =>
    problem.key === undefined
      ? "The profile must be a JSON object."
      : `${problem.key} must be ${expected(problem.key)}.`,
  "invalid-name": (problem) =>
    problem.key === undefined
      ? `The profile's name is not valid (it is not shown): use ${NAME_RULE}.`
      : `${problem.key} must name a profile: ${NAME_RULE}.`,
  "duplicate-name": () =>
    "The file lists this profile name twice: JSON keeps only the last one, so neither counts.",
  "unknown-key": (problem) =>
    problem.key === undefined
      ? "The profile holds a key that is not shown: it does not look like a key."
      : `${problem.key} is no key of a profile.`,
  "flavor-unknown": () =>
    `flavor must be one of ${Object.keys(FLAVORS).join(", ")} (the value is not shown).`,
  "auth-type-unknown": () =>
    `auth.type must be one of ${AUTH_TYPES.join(", ")} (the value is not shown).`,
  "auth-keys-mixed": () =>
    "auth mixes the keys of two kinds of credentials (Basic auth, OAuth, a bearer token): keep one.",
  "auth-type-mismatch": () =>
    'auth.type does not fit the other auth keys: OAuth keys need "oauth", a stored token "bearer", Basic auth keys "basic" or no type, "passthrough" takes none, and "none" switches them off.',
  "secret-twice": (problem) =>
    `Both ${subject(problem)} and ${subject(problem)}Env are set: keep one, the variable.`,
  "endpoint-alone": () =>
    "auth.authorizationEndpoint and auth.tokenEndpoint go together: set both, or neither and let auth.issuer name them.",
  "url-invalid": (problem) => `${subject(problem)} is no URL: use ${LINK}.`,
  "url-not-http": (problem) => `${subject(problem)} must start with http:// or https://.`,
  "url-credentials": (problem) =>
    `${subject(problem)} must not contain credentials (they are not shown): put them into auth.`,
  "url-query-or-fragment": (problem) =>
    `${subject(problem)} must not contain a query string or a fragment.`,
  "credential-in-shared-file": (problem) =>
    `${subject(problem)} is set, but a file others share names no credential, neither a secret nor the variable that holds one.`,
  "literal-secret": (problem) =>
    `${subject(problem)} holds a secret itself (it is not shown): name the variable that holds it, ${subject(problem)}Env.`,
  "variable-prefix": (problem) =>
    `${subject(problem)} must name a variable that starts with ${SECRET_VARIABLE_PREFIX} (the name is not shown).`,
  "secret-header": (problem) =>
    `${subject(problem)} carries a secret, and only a person's own config file stores a secret header.`,
  "dialect-not-served": () => "This client does not speak the API of this flavor.",
  "auth-type-not-served": () => "This client cannot authenticate with this auth.type.",
  "url-missing": () => `url is missing: this client needs the REST API root, ${LINK}.`,
  "process-engine-not-served": () =>
    'engine names a process engine this client does not reach: it reaches only "default".',
  "key-not-served": (problem) =>
    `This client does not apply ${subject(problem)}, so it refuses the profile rather than ignore it.`,
}

/**
 * The sentence for `problem`: the key it is about and what it takes, never a value of the file,
 * the name of a variable or a profile name.
 */
export function describeProblem(problem: Problem): string {
  return SENTENCES[problem.code](problem)
}
