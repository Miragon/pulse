import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { JsonView } from "./json-view.js"
import { rawJson } from "./raw-json.js"

const BEYOND_2_53 = rawJson("12345678901234567890")

/** The error `read` throws, or a failed test when it throws none. */
function failureOf(read: () => unknown): RuntimeError {
  try {
    read()
  } catch (error: unknown) {
    if (error instanceof RuntimeError) return error
    throw error
  }
  throw new Error("the read did not fail")
}

function expectUnexpected(read: () => unknown, message: string): void {
  const failure = failureOf(read)
  expect(failure.failure).toBe("unexpectedResponse")
  expect(failure.message).toBe(message)
}

const view = (record: Record<string, unknown>): JsonView => JsonView.of(record, "answer")

describe("JsonView.of", () => {
  it("reads an object", () => {
    expect(JsonView.of({ id: "a" }, "incident").requiredString("id")).toBe("a")
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a list", [{ id: "a" }]],
    ["a string", "a"],
    ["a number", 1],
    ["a boolean", true],
    ["a raw JSON value", BEYOND_2_53],
  ])("fails %s as no object, in words that name the answer", (_kind, value) => {
    expectUnexpected(() => JsonView.of(value, "incident"), "incident is not an object")
  })
})

describe("JsonView.ifObject", () => {
  it("reads an object", () => {
    expect(JsonView.ifObject({ type: "String" })?.value("type")).toBe("String")
  })

  it.each([null, undefined, ["a"], "a", 1, BEYOND_2_53])("is undefined for %j", (value) => {
    expect(JsonView.ifObject(value)).toBeUndefined()
  })
})

describe("JsonView.listOf", () => {
  it("reads every object of a list", () => {
    const rows = JsonView.listOf([{ id: "a" }, { id: "b" }], "incidents")
    expect(rows.map((row) => row.requiredString("id"))).toEqual(["a", "b"])
    expect(JsonView.listOf([], "incidents")).toEqual([])
  })

  it("fails what is no list", () => {
    expectUnexpected(() => JsonView.listOf({ id: "a" }, "incidents"), "incidents is not a list")
    expectUnexpected(() => JsonView.listOf(undefined, "incidents"), "incidents is not a list")
  })

  it("fails an item that is no object, by its place in the list", () => {
    expectUnexpected(
      () => JsonView.listOf([{ id: "a" }, "b"], "incidents"),
      "incidents[1] is not an object",
    )
  })
})

describe("a JsonView's values", () => {
  it("reads a value as it is", () => {
    const answer = view({ value: { nested: [1] }, empty: null })
    expect(answer.value("value")).toEqual({ nested: [1] })
    expect(answer.value("empty")).toBeNull()
    expect(answer.value("missing")).toBeUndefined()
  })

  it("reads a nested object, and fails one that is none", () => {
    const answer = view({ product: { name: "CIB seven" }, plain: "x" })
    expect(answer.object("product", "telemetry product").requiredString("name")).toBe("CIB seven")
    expectUnexpected(
      () => answer.object("plain", "telemetry product"),
      "telemetry product is not an object",
    )
    expectUnexpected(
      () => answer.object("missing", "telemetry product"),
      "telemetry product is not an object",
    )
  })
})

describe("a JsonView's strings", () => {
  const answer = (): JsonView => view({ id: "a", blank: "", none: null, count: 3 })

  it("reads a string, the empty one included", () => {
    expect(answer().optionalString("id")).toBe("a")
    expect(answer().optionalString("blank")).toBe("")
    expect(answer().requiredString("id")).toBe("a")
    expect(answer().requiredString("blank")).toBe("")
  })

  it("reads an absent or null string as none", () => {
    expect(answer().optionalString("missing")).toBeUndefined()
    expect(answer().optionalString("none")).toBeUndefined()
  })

  it("fails a required string that is absent or null as missing", () => {
    expectUnexpected(() => answer().requiredString("missing"), "missing is missing")
    expectUnexpected(() => answer().requiredString("none"), "none is missing")
  })

  it("fails a value that is no string", () => {
    expectUnexpected(() => answer().optionalString("count"), "count is not a string")
    expectUnexpected(() => answer().requiredString("count"), "count is not a string")
  })
})

describe("a JsonView's numbers", () => {
  const answer = (): JsonView =>
    view({ count: 3, zero: 0, none: null, text: "3", big: BEYOND_2_53 })

  it("reads a number, zero included", () => {
    expect(answer().optionalNumber("count")).toBe(3)
    expect(answer().optionalNumber("zero")).toBe(0)
    expect(answer().requiredNumber("count")).toBe(3)
    expect(answer().requiredNumber("zero")).toBe(0)
  })

  it("reads an absent or null number as none", () => {
    expect(answer().optionalNumber("missing")).toBeUndefined()
    expect(answer().optionalNumber("none")).toBeUndefined()
  })

  it("fails a required number that is absent or null as missing", () => {
    expectUnexpected(() => answer().requiredNumber("missing"), "missing is missing")
    expectUnexpected(() => answer().requiredNumber("none"), "none is missing")
  })

  it("fails a value that is no number, a raw JSON value included", () => {
    expectUnexpected(() => answer().optionalNumber("text"), "text is not a number")
    expectUnexpected(() => answer().requiredNumber("text"), "text is not a number")
    expectUnexpected(() => answer().requiredNumber("big"), "big is not a number")
  })
})

describe("a JsonView's lists", () => {
  const answer = (): JsonView =>
    view({
      children: [{ id: "c1" }, { id: "c2" }],
      none: null,
      one: { id: "c1" },
      mixed: [{ id: "c1" }, 2],
      failures: ["no target", "ambiguous"],
      numbers: ["a", 1],
      noList: "a",
    })

  it("reads the objects of a list, none when it is absent or null", () => {
    expect(
      answer()
        .optionalList("children")
        .map((child) => child.requiredString("id")),
    ).toEqual(["c1", "c2"])
    expect(answer().optionalList("missing")).toEqual([])
    expect(answer().optionalList("none")).toEqual([])
  })

  it("fails a list that is none, or an item of it that is no object", () => {
    expectUnexpected(() => answer().optionalList("one"), "one is not a list")
    expectUnexpected(() => answer().optionalList("mixed"), "mixed[1] is not an object")
  })

  it("reads the strings of a list, undefined when it is absent or null", () => {
    expect(answer().optionalStrings("failures")).toEqual(["no target", "ambiguous"])
    expect(view({ empty: [] }).optionalStrings("empty")).toEqual([])
    expect(answer().optionalStrings("missing")).toBeUndefined()
    expect(answer().optionalStrings("none")).toBeUndefined()
  })

  it("fails strings that are no list, or a value of it that is no string", () => {
    expectUnexpected(() => answer().optionalStrings("noList"), "noList is not a list")
    expectUnexpected(
      () => answer().optionalStrings("numbers"),
      "numbers holds a value that is not a string",
    )
  })
})
