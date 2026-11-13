/**
 * No verdict and no sentence repeats a value of the file: a value may be a credential pasted into
 * the wrong place, and a reader shows the sentences in a log, an editor or to a model.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { describeProblem } from "./describe.js"
import { parseProfileFile } from "./parse.js"
import { PROFILE_FIXTURES } from "./testing/index.js"
import { CREDENTIAL_POLICIES, PROBLEM_CODES, type Problem, type ProfileFile } from "./types.js"

const URL_A = "http://a:8080/engine-rest"

/** A secret: a marker no sentence holds, then anything. */
const valueSecret = fc.string({ minLength: 4 }).map((tail) => `S3CR3T-${tail}`)
/** A secret where a key or a name stands: it does not look like one (a blank), so never shown. */
const keySecret = fc.string({ minLength: 4 }).map((tail) => `s3cr3t ${tail}`)

/** A profile file with `secret` in one place where a value stands. */
const VALUE_PLACES: readonly ((secret: string) => unknown)[] = [
  (s) => ({ profiles: { p: { url: s } } }),
  (s) => ({ profiles: { p: { url: `https://user:${s}@engine/engine-rest` } } }),
  (s) => ({ profiles: { p: { url: `http://engine/engine-rest?key=${s}` } } }),
  (s) => ({ profiles: { p: { url: `${s}://engine/engine-rest` } } }),
  (s) => ({ profiles: { p: { url: URL_A, cockpitUrl: `https://u:${s}@engine/app/` } } }),
  (s) => ({ profiles: { p: { url: URL_A, cockpitUrl: `http://engine/app/#${s}` } } }),
  (s) => ({ profiles: { p: { url: URL_A, engine: s } } }),
  (s) => ({ profiles: { p: { url: URL_A, flavor: s } } }),
  (s) => ({ profiles: { p: { url: URL_A, environment: s } } }),
  (s) => ({ profiles: { p: { url: URL_A, output: s, timeout: s, readOnly: s } } }),
  (s) => ({ profiles: { p: { url: URL_A, colour: s } } }),
  (s) => ({ profiles: { p: s } }),
  (s) => ({ defaultProfile: s, profiles: { p: { url: URL_A } } }),
  (s) => ({ $schema: [s], profiles: {} }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { username: s, password: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: "basic", passwordEnv: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: "bearer", token: s, tokenEnv: s } } } }),
  (s) => ({
    profiles: {
      p: {
        url: URL_A,
        auth: { type: "oauth", issuer: s, clientId: s, clientSecret: s, audience: s, scopes: [s] },
      },
    },
  }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: "oauth", redirectPort: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, headers: { "X-Api-Key": s, "X-Note": `${s}\n` } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: s } } }),
]

/**
 * A token in the form of a variable name, such as GitHub's `ghp_…`: a valid ENV_NAME outside
 * ENGINE_SECRET_, pasted where a variable is named. Never shown, not even as a variable's name.
 */
const nameSecret = fc.stringMatching(/^[A-Za-z0-9_]{8,36}$/).map((tail) => `ghp_${tail}`)

/** A profile file with `secret` where the name of a variable stands. */
const VARIABLE_PLACES: readonly ((secret: string) => unknown)[] = [
  (s) => ({ profiles: { p: { url: URL_A, auth: { username: "u", passwordEnv: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { password: "x", passwordEnv: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: "bearer", tokenEnv: s } } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { type: "oauth", tokenEnv: s } } } }),
  (s) => ({
    profiles: { p: { url: URL_A, auth: { type: "oauth", clientId: "c", clientSecretEnv: s } } },
  }),
]

/** A key-like secret: if a scan read it as a key, a problem would name it. */
const keyLikeSecret = fc.stringMatching(/^[A-Za-z0-9]{4,16}$/).map((tail) => `S3cr3t${tail}`)
/** The space JSON allows between tokens, formatted files' line breaks included. */
const space = fc.constantFrom("", " ", "\n  ", "\t", "\r\n    ")

/** The first value of a key the text repeats: a string, a list, an object or any JSON. */
function firstValue(kind: string, secret: string): string {
  if (kind === "string") return JSON.stringify(secret)
  if (kind === "list") return `[${JSON.stringify(secret)}, {"a": 1}]`
  return kind === "object" ? `{"url": ${JSON.stringify(secret)}}` : kind
}

/**
 * A file whose text repeats a key at one level (`first`, then a member with the secret, then the
 * key with an object), as `s` spaces it: profiles, a profile's auth and headers, auth's own keys.
 */
const REPEATED_PLACES: readonly ((first: string, secret: string, s: string) => string)[] = [
  (f, x, s) => `{"profiles":${s}{"p":${s}${f},${s}"q":${s}"${x}",${s}"p":${s}{"url":"${URL_A}"}}}`,
  (f, x, s) =>
    `{"profiles":{"p":{"url":"${URL_A}",${s}"auth":${s}${f},${s}"password":${s}"${x}",${s}"auth":${s}{"username":"u"}}}}`,
  (f, x, s) =>
    `{"profiles":{"p":{"url":"${URL_A}",${s}"headers":${s}${f},${s}"x":${s}"${x}",${s}"headers":${s}{"X-A":"b"}}}}`,
  (f, x, s) =>
    `{"profiles":{"p":{"url":"${URL_A}","auth":{"type":${s}${f},${s}"username":${s}"${x}",${s}"type":"basic"}}}}`,
  (f, x, s) => `{"profiles":${s}${f},${s}"x":${s}"${x}",${s}"profiles":${s}{}}`,
]

/** A profile file with `secret` where a key or a profile name stands. */
const KEY_PLACES: readonly ((secret: string) => unknown)[] = [
  (s) => ({ [s]: 1, profiles: {} }),
  (s) => ({ profiles: { [s]: { url: URL_A } } }),
  (s) => ({ profiles: { p: { url: URL_A, [s]: true } } }),
  (s) => ({ profiles: { p: { url: URL_A, auth: { [s]: true } } } }),
  (s) => ({ profiles: { p: { url: URL_A, headers: { [s]: "x" } } } }),
]

function problemsOf(file: ProfileFile): Problem[] {
  return [
    ...(file.problem === undefined ? [] : [file.problem]),
    ...file.notes,
    ...file.profiles.flatMap((profile) => profile.problems),
  ]
}

/** Every verdict's problems and their sentences hold no trace of `secret`. */
function expectNoTrace(text: string, secret: string): void {
  for (const credentials of CREDENTIAL_POLICIES) {
    const problems = problemsOf(parseProfileFile(text, { credentials }))
    expect(JSON.stringify(problems)).not.toContain(secret)
    for (const problem of problems) expect(describeProblem(problem)).not.toContain(secret)
  }
}

describe("no problem and no sentence repeats a value of the file", () => {
  it("wherever a value stands", () => {
    fc.assert(
      fc.property(valueSecret, fc.constantFrom(...VALUE_PLACES), (secret, place) => {
        expectNoTrace(JSON.stringify(place(secret)), secret)
      }),
    )
  })

  it("wherever a key or a name stands that does not look like one", () => {
    fc.assert(
      fc.property(keySecret, fc.constantFrom(...KEY_PLACES), (secret, place) => {
        expectNoTrace(JSON.stringify(place(secret)), secret)
      }),
    )
  })

  it("wherever a variable is named, a token in the form of a variable name included", () => {
    fc.assert(
      fc.property(nameSecret, fc.constantFrom(...VARIABLE_PLACES), (secret, place) => {
        expectNoTrace(JSON.stringify(place(secret)), secret)
      }),
    )
  })

  it("after a key the text repeats, whatever its first value and the space around it", () => {
    const first = fc.oneof(fc.constantFrom("string", "list", "object", '""', "[]"), fc.json())
    fc.assert(
      fc.property(
        keyLikeSecret,
        fc.constantFrom(...REPEATED_PLACES),
        first,
        space,
        (secret, place, kind, s) => {
          const text = place(firstValue(kind, secret), secret, s)
          expect(() => JSON.parse(text) as unknown).not.toThrow()
          expectNoTrace(text, secret)
        },
      ),
    )
  })

  it("in text that is not JSON, and in a key the text repeats", () => {
    fc.assert(
      fc.property(valueSecret, keySecret, (value, key) => {
        expectNoTrace(`{"profiles": {"p": {"url": ${JSON.stringify(value)},, }}}`, value)
        expectNoTrace(`{${JSON.stringify(key)}: 1, ${JSON.stringify(key)}: 2}`, key)
      }),
    )
  })
})

describe("describeProblem", () => {
  it("words every code in a sentence, with a key or without", () => {
    for (const code of PROBLEM_CODES) {
      for (const problem of [{ code }, { code, key: "url" }, { code, line: 2, column: 3 }]) {
        expect(describeProblem(problem), code).toMatch(/^\S.*\.$/)
      }
    }
  })

  it("words every problem of the shared fixtures", () => {
    const problems = PROFILE_FIXTURES.flatMap((fixture) =>
      CREDENTIAL_POLICIES.flatMap((credentials) =>
        problemsOf(parseProfileFile(fixture.text, { credentials })),
      ),
    )
    expect(problems.length).toBeGreaterThan(100)
    for (const problem of problems) expect(describeProblem(problem)).toMatch(/^\S.*\.$/)
  })

  it("words a key it has no expectation for, without a value, a name of the prototype too", () => {
    expect(describeProblem({ code: "invalid", key: "auth.later" })).toBe(
      "auth.later must be of another kind.",
    )
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(describeProblem({ code: "invalid", key })).toBe(`${key} must be of another kind.`)
    }
  })

  it("words a key twice: a header name in any spelling, any other key as JSON keeps it", () => {
    expect(describeProblem({ code: "duplicate-key", key: "headers.x-tenant" })).toBe(
      "headers.x-tenant is set twice, in one spelling or two (header names ignore case): set it once.",
    )
    expect(describeProblem({ code: "duplicate-key", key: "headers" })).toBe(
      "headers is set twice, and JSON keeps only the last one without a word: set it once.",
    )
    expect(describeProblem({ code: "duplicate-key" })).toBe(
      "A key that is not shown is set twice: set it once.",
    )
  })

  it("names where the text stops being JSON, and what each key takes", () => {
    expect(describeProblem({ code: "not-json", line: 1, column: 14 })).toBe(
      "The text is not valid JSON (line 1, column 14).",
    )
    expect(describeProblem({ code: "invalid", key: "timeout" })).toBe(
      "timeout must be a whole number of milliseconds between 1 and 2147483647.",
    )
    expect(describeProblem({ code: "variable-prefix", key: "auth.tokenEnv" })).toBe(
      "auth.tokenEnv must name a variable that starts with ENGINE_SECRET_ (the name is not shown).",
    )
    expect(describeProblem({ code: "literal-secret", key: "auth.password" })).toBe(
      "auth.password holds a secret itself (it is not shown): name the variable that holds it, auth.passwordEnv.",
    )
  })
})
