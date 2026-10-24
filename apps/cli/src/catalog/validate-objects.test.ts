/** validateBody on objects and their properties (validate.ts). */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { problems } from "../../test/support/catalog-validate.js"
import type { Schema } from "./types.js"
import { validateBody } from "./validate.js"

const closed: Schema = {
  type: "object",
  properties: {
    businessKey: { type: "string" },
    caseInstanceId: { type: "string" },
    count: { type: "integer" },
  },
}

describe("validateBody: objects", () => {
  it("reports missing required properties at the object path", () => {
    const schema = {
      type: "object",
      required: ["workerId", "maxTasks"],
      properties: { workerId: { type: "string" }, maxTasks: { type: "integer" } },
    }
    expect(problems(schema, {})).toEqual([
      { path: "$", message: 'missing required property "workerId"' },
      { path: "$", message: 'missing required property "maxTasks"' },
    ])
    expect(problems(schema, { workerId: "w", maxTasks: undefined })).toEqual([
      { path: "$", message: 'missing required property "maxTasks"' },
    ])
    expect(problems(schema, { workerId: "w", maxTasks: 1 })).toEqual([])
  })

  it("does not take inherited properties as present", () => {
    const schema = { type: "object", required: ["toString"], properties: { toString: {} } }
    expect(problems(schema, {})).toEqual([
      { path: "$", message: 'missing required property "toString"' },
    ])
  })

  it("reports unknown properties with a suggestion", () => {
    expect(problems(closed, { businesKey: "x" })).toEqual([
      { path: "$", message: 'unknown property "businesKey", did you mean "businessKey"?' },
    ])
    expect(problems(closed, { BUSINESSKEY: "x" })).toEqual([
      { path: "$", message: 'unknown property "BUSINESSKEY", did you mean "businessKey"?' },
    ])
    expect(problems(closed, { cont: 1 })).toEqual([
      { path: "$", message: 'unknown property "cont", did you mean "count"?' },
    ])
    expect(problems(closed, { coun: 1 })).toEqual([
      { path: "$", message: 'unknown property "coun", did you mean "count"?' },
    ])
    expect(problems(closed, { cnt: 1 })).toEqual([
      { path: "$", message: 'unknown property "cnt", did you mean "count"?' },
    ])
    expect(problems(closed, { counter: 1 })).toEqual([
      { path: "$", message: 'unknown property "counter", did you mean "count"?' },
    ])
  })

  it("suggests nothing beyond edit distance 2", () => {
    expect(problems(closed, { ct: 1 })).toEqual([{ path: "$", message: 'unknown property "ct"' }])
    expect(problems(closed, { counters: 1 })).toEqual([
      { path: "$", message: 'unknown property "counters"' },
    ])
    expect(problems(closed, { xyz: 1 })).toEqual([{ path: "$", message: 'unknown property "xyz"' }])
  })

  it("suggests the nearest property, the first one on ties", () => {
    const schema = {
      type: "object",
      properties: { abcd: {}, abce: {}, abxy: {} },
    }
    expect(problems(schema, { abcf: 1 })).toEqual([
      { path: "$", message: 'unknown property "abcf", did you mean "abcd"?' },
    ])
    expect(problems(schema, { abxz: 1 })).toEqual([
      { path: "$", message: 'unknown property "abxz", did you mean "abxy"?' },
    ])
    expect(problems({ type: "object", properties: { ab: {}, AB: {} } }, { Ab: 1 })).toEqual([
      { path: "$", message: 'unknown property "Ab", did you mean "ab"?' },
    ])
  })

  it("prefers a case-insensitive match over a closer name", () => {
    const schema = { type: "object", properties: { abc: {}, ABD: {} } }
    expect(problems(schema, { abd: 1 })).toEqual([
      { path: "$", message: 'unknown property "abd", did you mean "ABD"?' },
    ])
  })

  it("treats inherited names as unknown", () => {
    expect(problems(closed, { constructor: 1, toString: "x" })).toEqual([
      { path: "$", message: 'unknown property "constructor"' },
      { path: "$", message: 'unknown property "toString"' },
    ])
  })

  it("validates known properties at their path", () => {
    expect(problems(closed, { businessKey: 1, count: "x" })).toEqual([
      { path: "businessKey", message: "expected string, got 1" },
      { path: "count", message: 'expected integer, got "x"' },
    ])
  })

  it("skips undefined values", () => {
    expect(problems(closed, { businessKey: undefined, other: undefined })).toEqual([])
  })

  it("accepts any property without properties or additionalProperties", () => {
    expect(problems({ type: "object" }, { a: 1, b: { c: 2 } })).toEqual([])
  })

  it("accepts any property with additionalProperties: true", () => {
    expect(problems({ ...closed, additionalProperties: true }, { other: 1 })).toEqual([])
  })

  it("rejects every unknown property with additionalProperties: false", () => {
    expect(problems({ type: "object", additionalProperties: false }, { a: 1 })).toEqual([
      { path: "$", message: 'unknown property "a"' },
    ])
  })

  it("validates additional properties against their schema", () => {
    const map = {
      type: "object",
      properties: { fixed: { type: "string" } },
      additionalProperties: { type: "integer" },
    }
    expect(problems(map, { fixed: "x", a: 1, b: "two" })).toEqual([
      { path: "b", message: 'expected integer, got "two"' },
    ])
  })

  it("merges properties and required across allOf", () => {
    const schemas = {
      Base: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    }
    const schema = {
      allOf: [
        { $ref: "#/components/schemas/Base" },
        { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      ],
    }
    expect(problems(schema, { id: "a", name: "n" }, schemas)).toEqual([])
    expect(problems(schema, { nme: "n" }, schemas)).toEqual([
      { path: "$", message: 'missing required property "id"' },
      { path: "$", message: 'missing required property "name"' },
      { path: "$", message: 'unknown property "nme", did you mean "name"?' },
    ])
  })

  it("builds paths for nested and unusual keys", () => {
    const schema = {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: { type: { type: "string" } },
      },
    }
    expect(
      problems(schema, { amount: { type: 1 }, "my-var": { type: 2 }, "a.b": { type: 3 } }),
    ).toEqual([
      { path: "amount.type", message: "expected string, got 1" },
      { path: "my-var.type", message: "expected string, got 2" },
      { path: '$["a.b"].type', message: "expected string, got 3" },
    ])
    expect(
      problems({ type: "object", additionalProperties: { type: "string" } }, { "a b": 1 }),
    ).toEqual([{ path: '$["a b"]', message: "expected string, got 1" }])
    expect(
      problems(
        { type: "object", properties: { v: schema } },
        { v: { "1x": { type: 0 }, $ok: { type: 0 }, _u: { type: 0 } } },
      ).map((problem) => problem.path),
    ).toEqual(['v["1x"].type', "v.$ok.type", "v._u.type"])
  })
})

describe("validateBody: properties", () => {
  interface Case {
    readonly schema: Schema
    readonly value: unknown
  }

  const scalarCase: fc.Arbitrary<Case> = fc.oneof(
    fc.string().map((value) => ({ schema: { type: "string" }, value })),
    fc.integer().map((value) => ({ schema: { type: "integer" }, value })),
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((value) => ({ schema: { type: "number" }, value })),
    fc.boolean().map((value) => ({ schema: { type: "boolean" }, value })),
    fc
      .uniqueArray(fc.string(), { minLength: 1, maxLength: 5 })
      .chain((choices) =>
        fc
          .constantFrom(...choices)
          .map((value) => ({ schema: { type: "string", enum: choices }, value })),
      ),
    fc.jsonValue().map((value) => ({ schema: {}, value })),
  )

  const nullable = (arbitrary: fc.Arbitrary<Case>): fc.Arbitrary<Case> =>
    fc.oneof(
      arbitrary,
      arbitrary.map(({ schema }) => ({ schema: { ...schema, nullable: true }, value: null })),
    )

  const { matching } = fc.letrec<{ matching: Case }>((tie) => ({
    matching: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      nullable(scalarCase),
      fc.array(fc.integer(), { maxLength: 4 }).map((values): Case => ({
        schema: { type: "array", items: { type: "integer" } },
        value: values,
      })),
      tie("matching").map((item): Case => ({
        schema: { type: "array", items: item.schema },
        value: [item.value, item.value],
      })),
      fc
        .dictionary(fc.stringMatching(/^[a-z]{1,6}$/), tie("matching"), { maxKeys: 4 })
        .chain((entries) =>
          fc.subarray(Object.keys(entries)).map((present): Case => ({
            schema: {
              type: "object",
              properties: Object.fromEntries(
                Object.entries(entries).map(([key, entry]) => [key, entry.schema]),
              ),
            },
            value: Object.fromEntries(present.map((key) => [key, entries[key]?.value])),
          })),
        ),
    ),
  }))

  it("accepts values generated to match their schema", () => {
    fc.assert(
      fc.property(matching, ({ schema, value }) => {
        expect(validateBody(schema, value, {})).toEqual([])
      }),
    )
  })

  it("reports exactly the unknown key added to a closed object", () => {
    const closedObject = fc
      .dictionary(fc.stringMatching(/^[a-z]{1,6}$/), scalarCase, { minKeys: 1, maxKeys: 4 })
      .map((entries) => ({
        schema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(entries).map(([key, entry]) => [key, entry.schema]),
          ),
        },
        value: Object.fromEntries(
          Object.entries(entries).map(([key, entry]) => [key, entry.value]),
        ),
      }))
    fc.assert(
      fc.property(
        closedObject,
        fc.stringMatching(/^[A-Z][a-z]{0,8}$/),
        fc.jsonValue(),
        ({ schema, value }, key, extra) => {
          const result = validateBody(schema, { ...value, [key]: extra }, {})
          expect(result).toHaveLength(1)
          expect(result[0]?.path).toBe("$")
          expect(result[0]?.message).toMatch(
            new RegExp(`^unknown property "${key}"(, did you mean "[a-z]+"\\?)?$`),
          )
        },
      ),
    )
  })
})
