import { describe, expect, it } from "vitest"
import { DEFAULT_OBJECT_FORMAT, toEngineVariable, toEngineVariables } from "./variables.js"

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
