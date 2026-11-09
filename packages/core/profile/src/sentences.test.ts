/**
 * Every sentence of describeProblem word for word, each code with the key the parser or
 * refusalsOn gives it: the readers show these sentences in their errors, problem lists and boot
 * warnings, so a change of wording is a decision this file records. That no sentence repeats a
 * value of the file is describe.test.ts's.
 */

import { describe, expect, it } from "vitest"
import { describeProblem } from "./describe.js"
import { AUTH_KEYS, PROBLEM_CODES, type Problem, PROFILE_KEYS } from "./types.js"

const SENTENCES: readonly (readonly [Problem, string])[] = [
  [{ code: "not-json" }, "The text is not valid JSON."],
  [{ code: "not-json", line: 4, column: 2 }, "The text is not valid JSON (line 4, column 2)."],
  [{ code: "root-not-object" }, "The file must hold one JSON object."],
  [
    { code: "profiles-not-object", key: "profiles" },
    "profiles must be a JSON object that maps each profile name to a profile.",
  ],
  [{ code: "duplicate-key" }, "A key that is not shown is set twice: set it once."],
  [
    { code: "duplicate-key", key: "readOnly" },
    "readOnly is set twice, and JSON keeps only the last one without a word: set it once.",
  ],
  [
    { code: "duplicate-key", key: "headers.X-Tenant" },
    "headers.X-Tenant is set twice, in one spelling or two (header names ignore case): set it once.",
  ],
  [
    { code: "unknown-root-key" },
    "A key that is not shown is no key of a profile file, which holds $schema, defaultProfile and profiles.",
  ],
  [
    { code: "unknown-root-key", key: "profile" },
    "profile is no key of a profile file, which holds $schema, defaultProfile and profiles.",
  ],
  [
    { code: "default-not-found", key: "defaultProfile" },
    "defaultProfile names no profile of this file.",
  ],
  [{ code: "invalid" }, "The profile must be a JSON object."],
  [
    { code: "invalid-name" },
    'The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit.',
  ],
  [
    { code: "invalid-name", key: "defaultProfile" },
    'defaultProfile must name a profile: letters, digits, ".", "_" and "-", starting with a letter or digit.',
  ],
  [
    { code: "duplicate-name" },
    "The file lists this profile name twice: JSON keeps only the last one, so neither counts.",
  ],
  [
    { code: "unknown-key" },
    "The profile holds a key that is not shown: it does not look like a key.",
  ],
  [{ code: "unknown-key", key: "auth.scope" }, "auth.scope is no key of a profile."],
  [
    { code: "flavor-unknown", key: "flavor" },
    "flavor must be one of camunda7, cibseven, operaton (the value is not shown).",
  ],
  [
    { code: "auth-type-unknown", key: "auth.type" },
    "auth.type must be one of none, basic, bearer, oauth, passthrough (the value is not shown).",
  ],
  [
    { code: "auth-keys-mixed", key: "auth" },
    "auth mixes the keys of two kinds of credentials (Basic auth, OAuth, a bearer token): keep one.",
  ],
  [
    { code: "auth-type-mismatch", key: "auth.type" },
    'auth.type does not fit the other auth keys: OAuth keys need "oauth", a stored token "bearer", Basic auth keys "basic" or no type, "passthrough" takes none, and "none" switches them off.',
  ],
  [
    { code: "secret-twice", key: "auth.clientSecret" },
    "Both auth.clientSecret and auth.clientSecretEnv are set: keep one, the variable.",
  ],
  [
    { code: "endpoint-alone", key: "auth.tokenEndpoint" },
    "auth.authorizationEndpoint and auth.tokenEndpoint go together: set both, or neither and let auth.issuer name them.",
  ],
  [
    { code: "url-invalid", key: "url" },
    "url is no URL: use a URL such as http://localhost:8080/engine-rest.",
  ],
  [{ code: "url-not-http", key: "cockpitUrl" }, "cockpitUrl must start with http:// or https://."],
  [
    { code: "url-credentials", key: "url" },
    "url must not contain credentials (they are not shown): put them into auth.",
  ],
  [
    { code: "url-query-or-fragment", key: "cockpitUrl" },
    "cockpitUrl must not contain a query string or a fragment.",
  ],
  [
    { code: "credential-in-shared-file", key: "auth.passwordEnv" },
    "auth.passwordEnv is set, but a file others share names no credential, neither a secret nor the variable that holds one.",
  ],
  [
    { code: "literal-secret", key: "auth.token" },
    "auth.token holds a secret itself (it is not shown): name the variable that holds it, auth.tokenEnv.",
  ],
  [
    { code: "variable-prefix", key: "auth.clientSecretEnv" },
    "auth.clientSecretEnv must name a variable that starts with ENGINE_SECRET_ (the name is not shown).",
  ],
  [
    { code: "secret-header", key: "headers.Authorization" },
    "headers.Authorization carries a secret, and only a person's own config file stores a secret header.",
  ],
  [
    { code: "dialect-not-served", key: "flavor" },
    "This client does not speak the API of this flavor.",
  ],
  [
    { code: "auth-type-not-served", key: "auth.type" },
    "This client cannot authenticate with this auth.type.",
  ],
  [
    { code: "url-missing", key: "url" },
    "url is missing: this client needs the REST API root, a URL such as http://localhost:8080/engine-rest.",
  ],
  [
    { code: "process-engine-not-served", key: "engine" },
    'engine names a process engine this client does not reach: it reaches only "default".',
  ],
  [
    { code: "key-not-served", key: "headers" },
    "This client does not apply headers, so it refuses the profile rather than ignore it.",
  ],
]

/** What each key takes, in the sentence of a problem `invalid` about it. */
const TAKES: Readonly<Record<string, string>> = {
  $schema: "a string, the URL or path of a JSON Schema",
  defaultProfile: "a string that names one of the file's profiles",
  url: "a URL such as http://localhost:8080/engine-rest",
  cockpitUrl: "a URL such as http://localhost:8080/camunda/app/cockpit/default/",
  engine: 'the name of a process engine, not "." or ".."',
  flavor: "a string, one of camunda7, cibseven, operaton",
  environment:
    'an environment id: lower case letters, digits and "-", starting with a letter or digit',
  auth: 'an object such as {"type": "basic", "username": "demo"}',
  output: "json or table",
  timeout: "a whole number of milliseconds between 1 and 2147483647",
  headers:
    "an object that maps header names (HTTP tokens, not Connection, Content-Length, Expect, Keep-Alive, Transfer-Encoding or Upgrade) to ISO-8859-1 (Latin-1) values without control characters but tab",
  readOnly: "true or false",
  "auth.type": "a string, one of none, basic, bearer, oauth, passthrough",
  "auth.username": 'a non-empty string without ":" and without control characters',
  "auth.passwordEnv": "the name of an environment variable, such as ENGINE_SECRET_PROD_PASSWORD",
  "auth.password": "a non-empty string",
  "auth.issuer": "a URL such as https://login.example.com/realms/engine",
  "auth.authorizationEndpoint": "a URL",
  "auth.tokenEndpoint": "a URL",
  "auth.clientId": "a non-empty string",
  "auth.clientSecretEnv":
    "the name of an environment variable, such as ENGINE_SECRET_PROD_PASSWORD",
  "auth.clientSecret": "a non-empty string",
  "auth.scopes": 'a list of distinct scopes such as ["openid", "offline_access"]',
  "auth.audience": "a non-empty string",
  "auth.redirectPort": "a whole number between 0 and 65535",
  "auth.tokenEnv": "the name of an environment variable, such as ENGINE_SECRET_PROD_PASSWORD",
  "auth.token": "a non-empty string",
}

describe("the sentences of describeProblem", () => {
  it.each(SENTENCES)("%j", (problem, sentence) => {
    expect(describeProblem(problem)).toBe(sentence)
  })

  it("cover every code", () => {
    const covered = new Set(SENTENCES.map(([problem]) => problem.code))
    expect(PROBLEM_CODES.filter((code) => !covered.has(code))).toEqual([])
  })

  it("say what each key of a file takes, the root's, a profile's and auth's", () => {
    const keys = [
      "$schema",
      "defaultProfile",
      ...PROFILE_KEYS,
      ...AUTH_KEYS.map((k) => `auth.${k}`),
    ]
    expect(Object.keys(TAKES)).toEqual(keys)
    for (const [key, takes] of Object.entries(TAKES)) {
      expect(describeProblem({ code: "invalid", key }), key).toBe(`${key} must be ${takes}.`)
    }
  })
})
