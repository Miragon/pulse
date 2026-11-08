import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { defaultProfileOf, parseProfileFile } from "./parse.js"
import { outcomeOf } from "./testing/index.js"
import { CREDENTIAL_POLICIES, type ProfileFile } from "./types.js"

const URL_A = "http://a:8080/engine-rest"

function parsed(file: unknown, credentials: "none" | "env" | "env-or-literal" = "env-or-literal") {
  return parseProfileFile(JSON.stringify(file), { credentials })
}

describe("parseProfileFile", () => {
  it("reads a file with a byte order mark, which JSON.parse refuses", () => {
    const file = parseProfileFile(`\uFEFF${JSON.stringify({ profiles: { a: { url: URL_A } } })}`, {
      credentials: "none",
    })
    expect(outcomeOf(file)).toEqual({ profiles: [{ name: "a" }] })
  })

  it("never throws, whatever the text", () => {
    // fc.json() writes no space and no key twice: a key twice whose first value is of another
    // kind, and the line breaks of a formatted file, come in on their own.
    const space = fc.constantFrom("", " ", "\n  ", "\t", "\r\n")
    const twice = fc
      .tuple(fc.json(), fc.json(), space)
      .map(
        ([a, b, s]) =>
          `{"profiles":${s}{"p":${s}${a},${s}"p":${s}{"auth":${s}${a},${s}"auth":${s}${b},${s}"headers":${s}${a},${s}"headers":${s}${b}}}}`,
      )
    const text = fc.oneof(
      fc.string(),
      fc.json(),
      fc.json().map((json) => `{"profiles": {"p": ${json}}}`),
      fc.json().map((json) => `{"profiles": {"p": {"auth": ${json}, "headers": ${json}}}}`),
      fc.jsonValue().map((value) => JSON.stringify({ profiles: { p: value } }, null, 2)),
      twice,
    )
    fc.assert(
      fc.property(text, fc.constantFrom(...CREDENTIAL_POLICIES), (candidate, credentials) => {
        const file = parseProfileFile(candidate, { credentials })
        expect(Array.isArray(file.profiles)).toBe(true)
      }),
    )
  })

  it("gives a usable profile only without problems, and every verdict its position", () => {
    const file = parsed({ profiles: { a: { url: URL_A }, b: { url: 1 }, "c d": { url: URL_A } } })
    expect(file.profiles.map(({ name, index, profile }) => [name, index, profile])).toEqual([
      ["a", 0, { url: URL_A }],
      ["b", 1, undefined],
      [undefined, 2, undefined],
    ])
  })

  it("takes __proto__ for a name like any other (refused, it is none)", () => {
    const file = parseProfileFile('{"profiles": {"__proto__": {"url": "http://a:8080"}}}', {
      credentials: "none",
    })
    expect(outcomeOf(file)).toEqual({ profiles: [{ index: 0, problems: ["invalid-name"] }] })
  })

  it("reads keys that hold escapes, brackets in strings and values nested deep", () => {
    const text = String.raw`{"profiles": {
      "a-b": {"url": "http://a:8080", "headers": {"X-Note": "{[\"}]"}},
      "deep": {"url": "http://a:8080", "auth": {"type": "oauth", "scopes": [["a"]]}}
    }}`
    expect(outcomeOf(parseProfileFile(text, { credentials: "none" }))).toEqual({
      profiles: [{ name: "a-b" }, { name: "deep", problems: ["invalid auth.scopes"] }],
    })
  })

  it("names an unknown root key in the text's order, and one that looks like no key never", () => {
    const text = '{"2": 1, "a key with blanks": 2, "zeta": 3, "profiles": {}}'
    expect(outcomeOf(parseProfileFile(text, { credentials: "none" }))).toEqual({
      notes: ["unknown-root-key", "unknown-root-key", "unknown-root-key zeta"],
    })
  })

  it("keeps the notes of a file whose profiles are no object", () => {
    expect(outcomeOf(parsed({ extra: 1, profiles: "p" }))).toEqual({
      problem: "profiles-not-object profiles",
      notes: ["unknown-root-key extra"],
    })
  })

  it("names a secret header that does not look like a key by its object alone", () => {
    const file = parsed(
      { profiles: { p: { url: URL_A, headers: { "X.Auth.Token": "t" } } } },
      "none",
    )
    expect(file.profiles[0]?.problems).toEqual([{ code: "secret-header", key: "headers" }])
  })

  it("hides a repeated root key that does not look like one", () => {
    const file = parseProfileFile('{"a b": 1, "a b": 2}', { credentials: "none" })
    expect(file.problem).toEqual({ code: "duplicate-key" })
  })

  it("refuses a variable under the env policy unless it extends ENGINE_SECRET_", () => {
    const verdict = (passwordEnv: string) =>
      parsed({ profiles: { p: { url: URL_A, auth: { username: "u", passwordEnv } } } }, "env")
        .profiles[0]?.problems
    expect(verdict("ENGINE_SECRET_P")).toEqual([])
    expect(verdict("ENGINE_SECRET_")).toEqual([
      { code: "variable-prefix", key: "auth.passwordEnv" },
    ])
    expect(verdict("ENGINE_SECRETS")).toEqual([
      { code: "variable-prefix", key: "auth.passwordEnv" },
    ])
    expect(verdict("MCP_METRICS_TOKEN")).toEqual([
      { code: "variable-prefix", key: "auth.passwordEnv" },
    ])
  })
})

describe("defaultProfileOf", () => {
  const file = (value: unknown) => parsed(value)

  it("is the file's defaultProfile, else its only profile, refused or not", () => {
    expect(defaultProfileOf(file({ defaultProfile: "b", profiles: { a: {}, b: {} } }))).toBe("b")
    expect(defaultProfileOf(file({ profiles: { a: { url: 1 } } }))).toBe("a")
    expect(defaultProfileOf(file({ profiles: { a: {}, b: { url: 1 } } }))).toBeUndefined()
    expect(defaultProfileOf(file({ profiles: {} }))).toBeUndefined()
  })

  it("never falls back to the only profile when defaultProfile is off", () => {
    for (const defaultProfile of ["other", "-x", 1]) {
      expect(defaultProfileOf(file({ defaultProfile, profiles: { a: {} } }))).toBeUndefined()
    }
    expect(defaultProfileOf(file({ defaultProfile: " ", profiles: { a: {} } }))).toBe("a")
  })

  it("is none for a file that gives no profiles, or an only profile without a valid name", () => {
    expect(defaultProfileOf(parseProfileFile("[]", { credentials: "none" }))).toBeUndefined()
    expect(defaultProfileOf(file({ profiles: { "a b": {} } }))).toBeUndefined()
    const failed: ProfileFile = { problem: { code: "root-not-object" }, notes: [], profiles: [] }
    expect(defaultProfileOf(failed)).toBeUndefined()
  })
})
