/**
 * The JSON Schema of the project file against the parser at the edges of each value: the shared
 * fixtures hold the cases Pulse for VS Code reads too, this file the boundaries only the CLI
 * checks (numbers, header names and values, names, scopes, the auth key rules), as a table and as
 * properties.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { parserVerdict, schemaVerdict } from "../../test/support/project-schema.js"
import { SECRET_HEADERS, SECRET_NAME_PARTS } from "../util.js"
import { CLIENT_HEADERS } from "./headers.js"

const URL = "http://localhost:8080/engine-rest"
const ISSUER = "https://login.example.com/realms/x"

type Case = readonly [label: string, valid: boolean, text: string]

function file(value: unknown): string {
  return JSON.stringify(value)
}

function profile(value: Record<string, unknown>): string {
  return file({ profiles: { p: { url: URL, ...value } } })
}

function auth(value: unknown): string {
  return profile({ auth: value })
}

function headers(value: unknown): string {
  return profile({ headers: value })
}

const CASES: readonly Case[] = [
  ["the smallest timeout", true, profile({ timeout: 1 })],
  ["the largest timeout", true, profile({ timeout: 2_147_483_647 })],
  ["a timeout written as 1.0", true, '{"profiles":{"p":{"timeout":1.0}}}'],
  ["a zero timeout", false, profile({ timeout: 0 })],
  ["a negative timeout", false, profile({ timeout: -1 })],
  ["a fractional timeout", false, profile({ timeout: 1.5 })],
  ["a timeout beyond a timer", false, profile({ timeout: 2_147_483_648 })],
  ["a timeout as text", false, profile({ timeout: "60000" })],
  ["an infinite timeout", false, '{"profiles":{"p":{"timeout":1e400}}}'],
  ["redirect port 0", true, auth({ type: "oauth", redirectPort: 0 })],
  ["redirect port 65535", true, auth({ type: "oauth", redirectPort: 65_535 })],
  ["redirect port 65536", false, auth({ type: "oauth", redirectPort: 65_536 })],
  ["a negative redirect port", false, auth({ type: "oauth", redirectPort: -1 })],
  ["a redirect port as text", false, auth({ type: "oauth", redirectPort: "8080" })],
  ["no scopes", true, auth({ type: "oauth", scopes: [] })],
  ["a duplicate scope", false, auth({ type: "oauth", scopes: ["openid", "openid"] })],
  ["a scope with a space", false, auth({ type: "oauth", scopes: ["open id"] })],
  ["a scope with a quote", false, auth({ type: "oauth", scopes: ['a"b'] })],
  ["a scope with a backslash", false, auth({ type: "oauth", scopes: ["a\\b"] })],
  ["a scope beyond ASCII", false, auth({ type: "oauth", scopes: ["é"] })],
  ["scopes as text", false, auth({ type: "oauth", scopes: "openid" })],
  ["a blank username", false, auth({ username: "  " })],
  ["a blank client id", false, auth({ type: "oauth", clientId: "" })],
  ["a blank audience", false, auth({ type: "oauth", audience: " " })],
  ["a blank issuer", false, auth({ type: "oauth", issuer: "" })],
  ["OAuth settings with type none", true, auth({ type: "none", issuer: ISSUER })],
  ["OAuth settings with an unknown type", true, auth({ type: "x", clientId: "c" })],
  ["OAuth settings with type bearer", false, auth({ type: "bearer", issuer: ISSUER })],
  ["a username with type bearer", false, auth({ type: "bearer", username: "u" })],
  ["a username with an unknown type", true, auth({ type: "x", username: "u" })],
  ["both endpoints", true, auth({ type: "oauth", authorizationEndpoint: "a", tokenEndpoint: "t" })],
  ["the token endpoint alone", false, auth({ type: "oauth", tokenEndpoint: "t" })],
  ["auth as an array", false, auth([])],
  ["auth as null", false, auth(null)],
  ["no headers", true, headers({})],
  ["headers as an array", false, headers([])],
  ["a header name with a space", false, headers({ "X A": "b" })],
  ["an empty header name", false, headers({ "": "b" })],
  ["a header name beyond ASCII", false, headers({ "X-É": "b" })],
  ["Content-Length in capitals", false, headers({ "CONTENT-LENGTH": "1" })],
  ["Upgrade", false, headers({ Upgrade: "h2c" })],
  ["Cookie", false, headers({ Cookie: "a=b" })],
  ["a name with Token inside", false, headers({ "X-Auth-Token-Id": "1" })],
  ["a name with apikey inside", false, headers({ "x-apikey": "1" })],
  ["a name only starting like Authorization", true, headers({ "Authorization-Hint": "1" })],
  ["an empty header value", true, headers({ "X-A": "" })],
  ["a tab in a value", true, headers({ "X-A": "a\tb" })],
  ["NUL in a value", false, headers({ "X-A": "a\u0000b" })],
  ["DEL in a value", false, headers({ "X-A": "\u007f" })],
  ["a C1 control in a value", false, headers({ "X-A": "\u0085" })],
  ["U+00A0 in a value", true, headers({ "X-A": " " })],
  ["U+0100 in a value", false, headers({ "X-A": "Ā" })],
  ["an emoji in a value", false, headers({ "X-A": "😀" })],
  ["a lone surrogate in a value", false, '{"profiles":{"p":{"headers":{"X-A":"\\ud800"}}}}'],
  ["a number as a value", false, headers({ "X-A": 1 })],
  ["engine . with blanks", false, profile({ engine: " . " })],
  ["engine ...", true, profile({ engine: "..." })],
  ["engine . .", true, profile({ engine: ". ." })],
  ["a blank engine", false, profile({ engine: "\t" })],
  ["a profile name with a dot inside", true, file({ profiles: { "a.b_c-d": {} } })],
  ["a profile name starting with a dot", false, file({ profiles: { ".a": {} } })],
  ["the profile name __proto__", false, '{"profiles":{"__proto__":{}}}'],
  ["a profile name with a slash", false, file({ profiles: { "a/b": {} } })],
  ["a profile name beyond ASCII", false, file({ profiles: { é: {} } })],
  ["an empty profile", true, file({ profiles: { p: {} } })],
  [
    "a defaultProfile with tab and newline around",
    true,
    file({ defaultProfile: "\tp\n", profiles: { p: {} } }),
  ],
  ["a defaultProfile with an inner blank", false, file({ defaultProfile: "p q", profiles: {} })],
  ["an empty defaultProfile and no profiles", true, file({ defaultProfile: "" })],
  ["a defaultProfile without profiles", false, file({ defaultProfile: "p" })],
  ["$schema as a path", true, file({ $schema: "./schema.json" })],
  ["$schema as null", false, file({ $schema: null })],
  ["readOnly as 1", false, profile({ readOnly: 1 })],
  ["readOnly as null", false, profile({ readOnly: null })],
  ["output JSON in capitals", false, profile({ output: "JSON" })],
  ["flavor in capitals", false, profile({ flavor: "Camunda7" })],
  ["url as null", false, profile({ url: null })],
]

describe("the project file schema at the edges", () => {
  it.each(CASES)("%s: valid %s", (_label, valid, text) => {
    const parser = parserVerdict(text)
    const schema = schemaVerdict(text)
    expect(parser.valid, parser.valid ? "parser" : parser.reason).toBe(valid)
    expect(schema.valid, schema.valid ? "schema" : schema.reason).toBe(valid)
  })
})

/** Both say the same about the text. */
function agree(text: string): void {
  const parser = parserVerdict(text)
  const schema = schemaVerdict(text)
  expect(
    schema.valid,
    `${text}\nparser: ${JSON.stringify(parser)}\nschema: ${JSON.stringify(schema)}`,
  ).toBe(parser.valid)
}

/** A word in random case: the CLI compares header names case-insensitively. */
function anyCase(word: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((upper) =>
      upper
        .map((up, at) => (up ? word.charAt(at).toUpperCase() : word.charAt(at).toLowerCase()))
        .join(""),
    )
}

/** Every header name the CLI refuses by list: secret names, secret name parts, client headers. */
const LISTED_HEADERS = [...SECRET_HEADERS, ...SECRET_NAME_PARTS, ...CLIENT_HEADERS]

const NAME_CHARS = fc.constantFrom(..."aZ09._-/ é:".split(""))
const HEADER_WORDS = fc.oneof(
  fc.constantFrom(...LISTED_HEADERS).chain(anyCase),
  fc.constantFrom("X-Tenant", "x y", "x:y", ""),
)
const VALUE_CHARS = fc.oneof(
  fc.integer({ min: 0, max: 0x2ff }).map((code) => String.fromCodePoint(code)),
  fc.constantFrom("😀", "\t", " "),
)

/** Both refuse a project file with this header name. */
function refusedHeader(name: string): void {
  const text = headers({ [name]: "v" })
  expect(parserVerdict(text).valid, `parser: ${name}`).toBe(false)
  expect(schemaVerdict(text).valid, `schema: ${name}`).toBe(false)
}

describe("the header names the CLI's lists refuse", () => {
  it.each(LISTED_HEADERS.flatMap((word) => [word, word.toUpperCase()]))(
    "%s is refused by the parser and the schema",
    (name) => {
      refusedHeader(name)
    },
  )

  it("are refused in any case, the secret name parts inside a longer name too", () => {
    const exact = fc.constantFrom(...SECRET_HEADERS, ...CLIENT_HEADERS).chain(anyCase)
    const inside = fc
      .tuple(
        fc.constantFrom("", "X-", "x-"),
        fc.constantFrom(...SECRET_NAME_PARTS).chain(anyCase),
        fc.constantFrom("", "-Id", "s"),
      )
      .map((parts) => parts.join(""))
    fc.assert(fc.property(fc.oneof(exact, inside), refusedHeader))
  })
})

describe("the project file schema and the parser agree", () => {
  it("on profile names and defaultProfile", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: NAME_CHARS }),
        fc.string({ unit: NAME_CHARS }),
        (name, other) => {
          agree(file({ defaultProfile: other, profiles: { [name]: {} } }))
        },
      ),
    )
  })

  it("on header names", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.constantFrom("", "X-", "x-"), HEADER_WORDS, fc.constantFrom("", "-Id", "s")),
        (parts) => {
          agree(headers({ [parts.join("")]: "v" }))
        },
      ),
    )
  })

  it("on header values", () => {
    fc.assert(
      fc.property(fc.string({ unit: VALUE_CHARS }), (value) => {
        agree(headers({ "X-A": value }))
      }),
    )
  })

  it("on engine names", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(" ", ".", "a", "\t", "\n") }), (engine) => {
        agree(profile({ engine }))
      }),
    )
  })

  it("on timeouts and redirect ports", () => {
    const number = fc.oneof(
      fc.integer({ min: -3, max: 3 }),
      fc.integer({ min: 2_147_483_640, max: 2_147_483_650 }),
      fc.integer({ min: 65_530, max: 65_540 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
    )
    fc.assert(
      fc.property(number, (value) => {
        agree(profile({ timeout: value }))
        agree(auth({ type: "oauth", redirectPort: value }))
      }),
    )
  })

  it("on the auth keys a type allows", () => {
    const keys = fc.subarray([
      "username",
      "issuer",
      "clientId",
      "tokenEndpoint",
      "authorizationEndpoint",
    ])
    const type = fc.constantFrom(undefined, "none", "basic", "oauth", "bearer", "x", "")
    fc.assert(
      fc.property(keys, type, (present, kind) => {
        const settings = Object.fromEntries(present.map((key) => [key, "v"]))
        agree(auth(kind === undefined ? settings : { type: kind, ...settings }))
      }),
    )
  })
})
