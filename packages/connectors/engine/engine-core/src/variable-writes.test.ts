import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  autoTypedValue,
  DEFAULT_OBJECT_FORMAT,
  toEngineVariable,
  toEngineVariables,
} from "./variable-writes.js"

const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1

/**
 * The wire shape per variable type. Each rule mirrors an engine refusal
 * verified against CIB Seven 2.2: a non-string Json/Xml/Object value is a 400
 * "Must provide 'null' or String value for value of SerializableValue type",
 * an Object without objectTypeName finds no serializer, an ISO "Z" date
 * cannot be converted to java.util.Date.
 */
describe("toEngineVariable", () => {
  it.each([
    ["String", "hello"],
    ["Long", 42],
    ["Integer", -7],
    ["Double", 1.5],
    ["Boolean", false],
    [undefined, "untyped"],
  ])("passes a %s value through unchanged", (type, value) => {
    expect(toEngineVariable("v", { value, type })).toEqual({ value, type })
  })

  it.each(["Json", "json"])(
    "stringifies a parsed %s value — the engine takes only the string",
    (type) => {
      expect(toEngineVariable("v", { value: { a: [1, 2] }, type })).toEqual({
        value: '{"a":[1,2]}',
        type,
      })
      expect(toEngineVariable("v", { value: [true], type }).value).toBe("[true]")
      expect(toEngineVariable("v", { value: 3, type }).value).toBe("3")
    },
  )

  it("keeps an already serialized Json string as is", () => {
    expect(toEngineVariable("v", { value: '{"a":1}', type: "Json" })).toEqual({
      value: '{"a":1}',
      type: "Json",
    })
  })

  it("passes null through for every serializable type", () => {
    expect(toEngineVariable("v", { value: null, type: "Json" }).value).toBeNull()
    expect(toEngineVariable("v", { value: null, type: "Xml" }).value).toBeNull()
    expect(toEngineVariable("v", { value: null, type: "Object" })).toEqual({
      value: null,
      type: "Object",
      valueInfo: { serializationDataFormat: DEFAULT_OBJECT_FORMAT },
    })
  })

  it("keeps an Xml document string and refuses anything else", () => {
    expect(toEngineVariable("doc", { value: "<a/>", type: "Xml" }).value).toBe("<a/>")
    expect(() => toEngineVariable("doc", { value: { a: 1 }, type: "Xml" })).toThrow(
      'Variable "doc": an Xml value must be the XML document as a string',
    )
  })

  it("writes an Object serialized, with its type name and a JSON format by default", () => {
    expect(
      toEngineVariable("order", {
        value: { id: 1 },
        type: "Object",
        valueInfo: { objectTypeName: "com.acme.Order" },
      }),
    ).toEqual({
      value: '{"id":1}',
      type: "Object",
      valueInfo: { objectTypeName: "com.acme.Order", serializationDataFormat: "application/json" },
    })
  })

  it("keeps an explicit Object serialization format (the read's valueInfo round-trips)", () => {
    const valueInfo = {
      objectTypeName: "java.util.ArrayList<java.lang.Integer>",
      serializationDataFormat: "application/x-java-serialized-object",
    }
    expect(toEngineVariable("o", { value: "rO0AB", type: "Object", valueInfo })).toEqual({
      value: "rO0AB",
      type: "Object",
      valueInfo,
    })
  })

  it.each([undefined, {}, { objectTypeName: "" }, { objectTypeName: 42 }])(
    "refuses an Object value without an objectTypeName (valueInfo %j)",
    (valueInfo) => {
      expect(() => toEngineVariable("order", { value: "[1]", type: "Object", valueInfo })).toThrow(
        'Variable "order": an Object value needs valueInfo.objectTypeName',
      )
    },
  )

  it("converts an ISO 8601 Date to the engine format", () => {
    expect(toEngineVariable("due", { value: "2026-10-01T08:30:00Z", type: "Date" })).toEqual({
      value: "2026-10-01T08:30:00.000+0000",
      type: "Date",
    })
    expect(toEngineVariable("due", { value: "2026-10-01", type: "date" }).value).toBe(
      "2026-10-01T00:00:00.000+0000",
    )
    expect(toEngineVariable("due", { value: null, type: "Date" }).value).toBeNull()
  })

  it("refuses a Date the engine could not parse, naming the variable", () => {
    expect(() => toEngineVariable("due", { value: "tomorrow", type: "Date" })).toThrow(
      /^Variable "due": Invalid date "tomorrow": expected ISO 8601/,
    )
    expect(() => toEngineVariable("due", { value: 1_700_000_000_000, type: "Date" })).toThrow(
      'Variable "due": a Date value must be an ISO 8601 string',
    )
  })

  it("passes a given valueInfo through for the other types", () => {
    expect(
      toEngineVariable("f", { value: "x", type: "String", valueInfo: { transient: true } }),
    ).toEqual({ value: "x", type: "String", valueInfo: { transient: true } })
    expect(toEngineVariable("f", { value: "x", type: "String" })).not.toHaveProperty("valueInfo")
  })
})

describe("toEngineVariables", () => {
  it("maps every entry and leaves an absent map absent", () => {
    expect(toEngineVariables(undefined)).toBeUndefined()
    expect(
      toEngineVariables({
        payload: { value: { a: 1 }, type: "Json" },
        amount: { value: 5, type: "Long" },
      }),
    ).toEqual({
      payload: { value: '{"a":1}', type: "Json" },
      amount: { value: 5, type: "Long" },
    })
  })
})

describe("autoTypedValue", () => {
  it.each([
    ["true", true, "Boolean"],
    ["false", false, "Boolean"],
    ["null", null, "Null"],
    ["0", 0, "Integer"],
    // JSON has no negative zero: -0 and 0 serialize alike
    ["-0", 0, "Integer"],
    ["42", 42, "Integer"],
    ["-17", -17, "Integer"],
    [String(INT32_MAX), INT32_MAX, "Integer"],
    [String(INT32_MIN), INT32_MIN, "Integer"],
    [String(INT32_MAX + 1), INT32_MAX + 1, "Long"],
    [String(INT32_MIN - 1), INT32_MIN - 1, "Long"],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER, "Long"],
    [String(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER, "Long"],
    ["9007199254740992", 9007199254740992n, "Long"],
    ["9223372036854775808", "9223372036854775808", "String"],
    ["1.5", 1.5, "Double"],
    ["-0.25", -0.25, "Double"],
    ["0.0", 0, "Double"],
    ["01234", "01234", "String"],
    ["1.", "1.", "String"],
    [".5", ".5", "String"],
    ["1e3", "1e3", "String"],
    ["x1.5", "x1.5", "String"],
    ["1.5x", "1.5x", "String"],
    ["x15", "x15", "String"],
    ["15x", "15x", "String"],
    ["TRUE", "TRUE", "String"],
    ["", "", "String"],
    ["hello world", "hello world", "String"],
  ])("types %j", (raw, value, type) => {
    expect(autoTypedValue(raw)).toEqual({ value, type })
  })

  it("classifies int32 integers as Integer", () => {
    fc.assert(
      fc.property(fc.integer({ min: INT32_MIN, max: INT32_MAX }), (n) => {
        expect(autoTypedValue(String(n))).toEqual({ value: n, type: "Integer" })
      }),
    )
  })

  it("classifies safe integers beyond int32 as Long", () => {
    const beyond = fc.oneof(
      fc.integer({ min: INT32_MAX + 1, max: Number.MAX_SAFE_INTEGER }),
      fc.integer({ min: Number.MIN_SAFE_INTEGER, max: INT32_MIN - 1 }),
    )
    fc.assert(
      fc.property(beyond, (n) => {
        expect(autoTypedValue(String(n))).toEqual({ value: n, type: "Long" })
      }),
    )
  })

  it("classifies plain decimals as Double", () => {
    fc.assert(
      fc.property(fc.integer(), fc.stringMatching(/^\d{1,6}$/), (whole, fraction) => {
        const raw = `${whole}.${fraction}`
        expect(autoTypedValue(raw)).toEqual({ value: Number(raw), type: "Double" })
      }),
    )
  })

  it("keeps everything else as String", () => {
    const other = fc
      .string()
      .filter(
        (raw) =>
          !["true", "false", "null"].includes(raw) &&
          !/^-?(0|[1-9]\d*)$/.test(raw) &&
          !/^-?(0|[1-9]\d*)\.\d+$/.test(raw),
      )
    fc.assert(
      fc.property(other, (raw) => {
        expect(autoTypedValue(raw)).toEqual({ value: raw, type: "String" })
      }),
    )
  })
})
