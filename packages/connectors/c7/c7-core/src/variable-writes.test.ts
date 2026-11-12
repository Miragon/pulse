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
 * verified against CIB seven 2.2: a non-string Json/Xml/Object value is a 400
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
    "stringifies a parsed %s value: the engine takes only the string",
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

  it("leaves an absent value absent", () => {
    expect(toEngineVariable("v", { type: "String" })).toEqual({ value: undefined, type: "String" })
    expect(toEngineVariable("v", {})).toEqual({ value: undefined, type: undefined })
  })
})

/**
 * JSON has no number that is not finite: `JSON.stringify` writes Infinity, -Infinity and NaN as
 * null. A model's `1e400` reads as Infinity once the tool's arguments are parsed, so it went out as
 * null and the write reported success (final review S3).
 */
describe("toEngineVariable refuses a number that is not finite", () => {
  const NOT_FINITE =
    "a number that is not finite (a number beyond the range of a double, such as 1e400, reads as " +
    "Infinity)"
  // A Double's text still reads as Infinity in the engine: a String keeps the number's digits.
  const REFUSAL =
    `Variable "amount": ${NOT_FINITE} would go out as null; ` +
    "send it as a variable of type String with its digits as text"
  // A Json or Object value's text passes through as it is, so JSON text keeps the digits.
  const HELD_REFUSAL =
    `Variable "amount": the value holds ${NOT_FINITE} that would go out as null; ` +
    "send the whole value as JSON text, which keeps its digits"
  // The scalar types, those toEngineVariable shapes itself (Json, Object, Date) and none.
  const TYPES = ["Double", "Long", "Integer", "String", "Json", "Object", "Date", undefined]

  it.each([
    ["1e400 as a tool's arguments read it", (JSON.parse('{"v":1e400}') as { v: number }).v],
    ["-1e400 as a tool's arguments read it", (JSON.parse('{"v":-1e400}') as { v: number }).v],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("refuses %s, whatever the type", (_label, value) => {
    for (const type of TYPES) {
      const write = () => toEngineVariable("amount", { value, type })
      expect(write, `type ${type}`).toThrow(RangeError)
      expect(write, `type ${type}`).toThrow(REFUSAL)
    }
  })

  it.each([
    ["an object", { total: Number.POSITIVE_INFINITY }],
    ["an array", [Number.NEGATIVE_INFINITY]],
    ["an object next to finite numbers", { count: 1, total: Number.NaN, label: "x" }],
    ["an array next to finite numbers", [1, 2, Number.POSITIVE_INFINITY]],
    ["deep down", { lines: [{ amount: 1 }, { amount: [null, true, Number.NaN] }] }],
  ])("refuses one inside %s, which JSON would write as null", (_label, value) => {
    for (const type of ["Json", "Object", undefined]) {
      const write = () =>
        toEngineVariable("amount", {
          value,
          type,
          valueInfo: { objectTypeName: "java.util.HashMap" },
        })
      expect(write, `type ${type}`).toThrow(RangeError)
      expect(write, `type ${type}`).toThrow(HELD_REFUSAL)
    }
  })

  it("lets the JSON text of such a value through, which keeps the digits", () => {
    const text = '{"total":1e400,"lines":[-1e400]}'
    for (const type of ["Json", "Object"]) {
      expect(
        toEngineVariable("amount", {
          value: text,
          type,
          valueInfo: { objectTypeName: "java.util.HashMap" },
        }).value,
      ).toBe(text)
    }
    expect(toEngineVariable("amount", { value: "1e400", type: "String" })).toEqual({
      value: "1e400",
      type: "String",
    })
  })

  it("keeps a finite number of every size, the largest double included", () => {
    for (const value of [0, -0, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, 1.5]) {
      expect(toEngineVariable("amount", { value, type: "Double" })).toEqual({
        value,
        type: "Double",
      })
    }
    const nested = { total: Number.MAX_VALUE, lines: [{ amount: -1.5 }], note: null, ok: true }
    expect(toEngineVariable("amount", { value: nested, type: "Json" }).value).toBe(
      JSON.stringify(nested),
    )
  })

  it("refuses exactly the numbers JSON cannot carry", () => {
    // fc.double() draws NaN and the infinities only now and then: every run gets them as well.
    const NOT_FINITE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...NOT_FINITE_NUMBERS), fc.double()), (value) => {
        const write = () => toEngineVariable("amount", { value, type: "Double" })
        if (Number.isFinite(value)) expect(write()).toEqual({ value, type: "Double" })
        else expect(write).toThrow(REFUSAL)
      }),
    )
  })

  it("refuses the whole map in toEngineVariables, naming the variable", () => {
    expect(() =>
      toEngineVariables({
        note: { value: "fine", type: "String" },
        amount: { value: Number.POSITIVE_INFINITY, type: "Double" },
      }),
    ).toThrow(REFUSAL)
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
    // Number() reads these as 1.5: only the form of the text keeps them a String.
    [" 1.5", " 1.5", "String"],
    ["1.5 ", "1.5 ", "String"],
    ["+1.5", "+1.5", "String"],
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

  // Number() reads a decimal beyond the range of a double as Infinity, which JSON sends as null:
  // a Double without a value. Its text keeps every digit.
  const LARGEST = `${BigInt(Number.MAX_VALUE)}.0`
  const BEYOND = `${2n ** 1024n}.0`
  const HUGE = `${"9".repeat(400)}.5`
  it.each([
    ["the largest double as a Double", LARGEST, Number.MAX_VALUE, "Double"],
    ["the most negative double as a Double", `-${LARGEST}`, -Number.MAX_VALUE, "Double"],
    ["2^1024 as a String", BEYOND, BEYOND, "String"],
    ["-2^1024 as a String", `-${BEYOND}`, `-${BEYOND}`, "String"],
    ["400 digits and .5 as a String", HUGE, HUGE, "String"],
    ["-(400 digits and .5) as a String", `-${HUGE}`, `-${HUGE}`, "String"],
  ])("types the decimal %s", (_label, raw, value, type) => {
    expect(autoTypedValue(raw)).toEqual({ value, type })
  })

  it("keeps a decimal beyond the range of a double as a String of its exact text", () => {
    const beyond = fc.tuple(
      fc.constantFrom("", "-"),
      fc.stringMatching(/^[1-9]\d{309,400}$/),
      fc.stringMatching(/^\d{1,6}$/),
    )
    fc.assert(
      fc.property(beyond, ([sign, whole, fraction]) => {
        const raw = `${sign}${whole}.${fraction}`
        expect(autoTypedValue(raw)).toEqual({ value: raw, type: "String" })
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
