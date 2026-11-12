/**
 * The JSON Schema (schema/pulse.schema.json) against the parser: it is never stricter. Where the
 * parser takes a file silently under any credential policy, the schema takes it too, so an editor
 * never marks what a reader loads; where the parser refuses what JSON Schema cannot see (where the
 * file comes from, a key twice, a URL's details, a default that names no profile), the schema may
 * take it. Each shared fixture pins the schema's verdict, so a change to either side shows here,
 * and random values in every place of a file hold the rule beyond the fixtures. The schema's
 * lists come from the package's constants, and none of its patterns backtracks.
 */

import { readFileSync } from "node:fs"
import { Ajv } from "ajv"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { parseProfileFile } from "../src/parse.js"
import { MAX_TIMEOUT_MS } from "../src/profile.js"
import { PROFILE_FIXTURES } from "../src/testing/index.js"
import {
  AUTH_KEYS,
  AUTH_TYPES,
  type AuthKey,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  CREDENTIAL_POLICIES,
  FLAVORS,
  OUTPUT_FORMATS,
  PROFILE_KEYS,
  ROOT_KEYS,
} from "../src/types.js"

interface SchemaNode {
  readonly $id?: string
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly definitions?: Readonly<Record<string, SchemaNode>>
  readonly enum?: readonly unknown[]
}

const SCHEMA_URL = new URL("../schema/pulse.schema.json", import.meta.url)
const SCHEMA = JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as SchemaNode
const MANIFEST = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  readonly name: string
  readonly files: readonly string[]
  readonly exports: Readonly<Record<string, unknown>>
}

/**
 * Strict: an unknown keyword, an unknown format or a type mix-up throws here instead of passing
 * silently. Only `strictRequired` is off: the dependency subschemas name required keys whose
 * definitions live in the auth object around them, which is how draft-07 dependencies work.
 */
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true })
const validate = ajv.compile(SCHEMA)

/** What the schema says about a file's text; text that is no JSON it cannot take. */
function schemaTakes(text: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return false
  }
  return validate(value)
}

/** The parser takes the file silently: no file problem, no note, no refused profile. */
function parserTakes(text: string, credentials: (typeof CREDENTIAL_POLICIES)[number]): boolean {
  const file = parseProfileFile(text, { credentials })
  return (
    file.problem === undefined &&
    file.notes.length === 0 &&
    file.profiles.every((profile) => profile.problems.length === 0)
  )
}

function node(path: readonly string[]): SchemaNode {
  let current: SchemaNode | undefined = SCHEMA
  for (const step of path) {
    current = current.properties?.[step] ?? current.definitions?.[step]
    if (current === undefined) throw new Error(`the schema has no ${path.join(".")}`)
  }
  return current
}

const keysOf = (path: readonly string[]) => Object.keys(node(path).properties ?? {}).sort()

describe("the JSON Schema", () => {
  it.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: says what the fixture pins, and takes what the parser takes silently",
    (_name, fixture) => {
      const takes = schemaTakes(fixture.text)
      expect(takes, JSON.stringify(validate.errors)).toBe(fixture.schema)
      const silent = CREDENTIAL_POLICIES.filter((policy) => parserTakes(fixture.text, policy))
      if (silent.length > 0)
        expect(takes, `the parser takes it under ${silent.join(", ")}`).toBe(true)
    },
  )

  it("refuses something in some fixtures and is blind to something in others", () => {
    const blind = PROFILE_FIXTURES.filter(
      (fixture) =>
        fixture.schema && CREDENTIAL_POLICIES.every((policy) => !parserTakes(fixture.text, policy)),
    )
    expect(PROFILE_FIXTURES.filter((fixture) => !fixture.schema).length).toBeGreaterThan(30)
    expect(blind.map((fixture) => fixture.name)).toEqual(
      expect.arrayContaining(["root-key-twice", "profile-name-twice", "url-refused"]),
    )
  })

  it("lists the keys and values of the package's constants", () => {
    expect(keysOf([])).toEqual([...ROOT_KEYS].sort())
    expect(keysOf(["profile"])).toEqual([...PROFILE_KEYS].sort())
    expect(keysOf(["auth"])).toEqual([...AUTH_KEYS].sort())
    expect(node(["profile", "flavor"]).enum).toEqual(Object.keys(FLAVORS))
    expect(node(["auth", "type"]).enum).toEqual(AUTH_TYPES)
    expect(node(["profile", "output"]).enum).toEqual(OUTPUT_FORMATS)
  })

  it("is published where its $id points: one export, listed literally, and in the files", () => {
    const path = "./schema/pulse.schema.json"
    expect(MANIFEST.exports[path]).toBe(path)
    expect(Object.keys(MANIFEST.exports).filter((key) => key.includes("*"))).toEqual([])
    expect(MANIFEST.files).toContain("schema")
    expect(SCHEMA.$id).toBe(`https://unpkg.com/${MANIFEST.name}/${path.slice(2)}`)
  })
})

const URL_A = "http://localhost:8080/engine-rest"

/**
 * One character where the rules draw their lines: printable ASCII most, Latin-1 (a header value
 * takes it), and space, tab, a line break, NUL, DEL, a C1 control, beyond Latin-1, a BOM.
 */
const edgeChar = fc
  .oneof(
    { weight: 4, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
    { weight: 2, arbitrary: fc.integer({ min: 0xa0, max: 0xff }) },
    { weight: 1, arbitrary: fc.constantFrom(0x09, 0x0a, 0x00, 0x7f, 0x85, 0x100, 0x2028, 0xfeff) },
  )
  .map((code) => String.fromCharCode(code))

/** Strings most, then values near the valid ones, objects and JSON of every kind. */
const anyValue: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.oneof(
      { weight: 3, arbitrary: fc.string({ unit: edgeChar }) },
      { weight: 1, arbitrary: fc.string() },
      { weight: 1, arbitrary: fc.string({ unit: "binary" }) },
      { weight: 1, arbitrary: fc.string({ unit: "grapheme" }) },
    ),
  },
  { weight: 1, arbitrary: fc.webUrl() },
  { weight: 1, arbitrary: fc.stringMatching(/^(?:ENGINE_SECRET_)?[A-Za-z_][A-Za-z0-9_]{0,12}$/) },
  {
    weight: 1,
    arbitrary: fc.oneof(
      fc.integer({ min: -2, max: 70_000 }),
      fc.constantFrom(MAX_TIMEOUT_MS, MAX_TIMEOUT_MS + 1, 1.5, 1e21),
    ),
  },
  {
    weight: 1,
    arbitrary: fc.array(fc.oneof(fc.string(), fc.constant("openid")), { maxLength: 3 }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      ...Object.keys(FLAVORS),
      ...OUTPUT_FORMATS,
      ...AUTH_TYPES,
      true,
      null,
    ),
  },
  {
    weight: 1,
    arbitrary: fc.dictionary(fc.oneof(fc.string(), fc.constant("X-A")), fc.string(), {
      maxKeys: 2,
    }),
  },
  { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 1 }) },
)

const isOf = (keys: readonly string[], key: string) => keys.includes(key)

/** An auth object of the kind `key` belongs to that is valid without it, so `key` alone decides. */
function authWith(key: Exclude<AuthKey, "type">, value: unknown): Record<string, unknown> {
  if (isOf(BASIC_AUTH_KEYS, key)) return { type: "basic", [key]: value }
  if (isOf(BEARER_AUTH_KEYS, key)) return { type: "bearer", [key]: value }
  return {
    type: "oauth",
    authorizationEndpoint: "https://login.example.com/auth",
    tokenEndpoint: "https://login.example.com/token",
    [key]: value,
  }
}

/** A value where a name stands: a string as it is, anything else as its JSON. */
const asName = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value))

const profileWith = (keys: Readonly<Record<string, unknown>>) => ({
  profiles: { p: { url: URL_A, ...keys } },
})

/** Every place of a file a value stands in, as a file with `value` there. */
const PLACES: readonly (readonly [string, (value: unknown) => unknown])[] = [
  ...PROFILE_KEYS.map((key) => [key, (value: unknown) => profileWith({ [key]: value })] as const),
  ["auth.type", (value) => profileWith({ auth: { type: value } })],
  ["auth.type with a username", (value) => profileWith({ auth: { username: "u", type: value } })],
  ...AUTH_KEYS.filter((key) => key !== "type").map(
    (key) =>
      [`auth.${key}`, (value: unknown) => profileWith({ auth: authWith(key, value) })] as const,
  ),
  ["a header's name", (value) => profileWith({ headers: { [asName(value)]: "v" } })],
  ["a header's value", (value) => profileWith({ headers: { "X-A": value } })],
  ["a profile's name", (value) => ({ profiles: { [asName(value)]: { url: URL_A } } })],
  ["defaultProfile", (value) => ({ defaultProfile: value, profiles: { p: { url: URL_A } } })],
  ["$schema", (value) => ({ $schema: value, profiles: {} })],
]

/** A valid value of each auth key, for auth objects that combine them. */
const AUTH_VALUES: Readonly<Record<Exclude<AuthKey, "type">, unknown>> = {
  username: "demo",
  passwordEnv: "ENGINE_SECRET_PASSWORD",
  password: "pw",
  issuer: "https://login.example.com/realms/engine",
  authorizationEndpoint: "https://login.example.com/auth",
  tokenEndpoint: "https://login.example.com/token",
  clientId: "pulse",
  clientSecretEnv: "ENGINE_SECRET_CLIENT",
  clientSecret: "s",
  scopes: ["openid"],
  audience: "engine",
  redirectPort: 0,
  tokenEnv: "ENGINE_SECRET_TOKEN",
  token: "t",
}

/** Whether the parser takes `file` silently under a policy; if it does, the schema must take it. */
function holdsSchemaToParser(file: unknown): boolean {
  const text = JSON.stringify(file)
  if (!CREDENTIAL_POLICIES.some((policy) => parserTakes(text, policy))) return false
  expect(schemaTakes(text), text).toBe(true)
  return true
}

describe("the JSON Schema on random values", () => {
  it.each(PLACES)("%s: takes what the parser takes silently", (_place, fileWith) => {
    let silent = 0
    fc.assert(
      fc.property(anyValue, (value) => {
        if (holdsSchemaToParser(fileWith(value))) silent += 1
      }),
      { numRuns: 1000 },
    )
    expect(silent).toBeGreaterThan(0)
  })

  it("takes what the parser takes silently, however auth's keys combine", () => {
    const keys = AUTH_KEYS.filter((key) => key !== "type")
    let silent = 0
    fc.assert(
      fc.property(fc.subarray(keys), fc.option(fc.constantFrom(...AUTH_TYPES)), (chosen, type) => {
        const auth = Object.fromEntries(chosen.map((key) => [key, AUTH_VALUES[key]]))
        if (holdsSchemaToParser(profileWith({ auth: type === null ? auth : { ...auth, type } })))
          silent += 1
      }),
      { numRuns: 1000 },
    )
    expect(silent).toBeGreaterThan(0)
  })
})

/** Every pattern of `node`: each `pattern`, and the keys of each `patternProperties`. */
function patternsOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(patternsOf)
  if (typeof node !== "object" || node === null) return []
  const entries: [string, unknown][] = Object.entries(node as Readonly<Record<string, unknown>>)
  return entries.flatMap(([key, value]) => [
    ...(key === "pattern" && typeof value === "string" ? [value] : []),
    ...(key === "patternProperties" && typeof value === "object" && value !== null
      ? Object.keys(value)
      : []),
    ...patternsOf(value),
  ])
}

describe("the JSON Schema's patterns", () => {
  // An editor checks the file on every keystroke: a pattern that backtracks takes about a second
  // on 50,000 characters (it grows with the square of the length), a linear one a millisecond.
  it("check a long value in linear time", () => {
    const patterns = patternsOf(SCHEMA)
    expect(patterns.length).toBeGreaterThan(10)
    const inputs = [" ", "a", ".", "-", "\t"].flatMap((unit) =>
      ["!", ":", "\u0000", " x"].map((end) => `${unit.repeat(50_000)}${end}`),
    )
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, "u")
      const started = performance.now()
      for (const input of inputs) regex.test(input)
      expect(performance.now() - started, pattern).toBeLessThan(250)
    }
  })
})
