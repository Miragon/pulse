import { describe, expect, it } from "vitest"
import { isReference, propertyNames, refName, resolve } from "./openapi.js"

describe("refName and isReference", () => {
  it("names the last segment of a $ref", () => {
    expect(refName("#/components/schemas/BatchDto")).toBe("BatchDto")
    expect(refName("BatchDto")).toBe("BatchDto")
  })

  it("tells a reference from anything else", () => {
    expect(isReference({ $ref: "#/x" })).toBe(true)
    expect([null, "x", {}, { $ref: 1 }].map(isReference)).toEqual([false, false, false, false])
  })
})

describe("resolve", () => {
  const components = { Ok: { content: {} } }

  it("returns a value that is no reference as it is", () => {
    const value = { content: {} }
    expect(resolve(value, components)).toBe(value)
  })

  it("follows a local reference to its component", () => {
    expect(resolve({ $ref: "#/components/responses/Ok" }, components)).toBe(components.Ok)
  })

  it.each([
    ["#/components/responses/Gone", components],
    ["#/components/responses/Ok", undefined],
    ["other.json#/Ok", components],
    ["#/components/responses/constructor", components],
  ])("fails on %s", (target, available) => {
    expect(() => resolve({ $ref: target }, available)).toThrow(
      new Error(`Unresolvable $ref: ${target}`),
    )
  })
})

describe("propertyNames", () => {
  const schemas = {
    Base: { properties: { id: {}, name: {} } },
    Alias: { $ref: "#/components/schemas/Base" },
    Loop: { allOf: [{ $ref: "#/components/schemas/Loop" }], properties: { loop: {} } },
  }

  it("names the properties of an object schema, merged across allOf and $refs", () => {
    const schema = { allOf: [{ $ref: "#/components/schemas/Alias" }], properties: { own: {} } }
    expect(propertyNames(schema, schemas)).toEqual(["id", "name", "own"])
  })

  it("reads each schema once, so a cyclic allOf ends", () => {
    expect(propertyNames({ $ref: "#/components/schemas/Loop" }, schemas)).toEqual(["loop"])
  })

  it("skips what is no schema: an unknown $ref, a property or part that is no object", () => {
    const schema = {
      allOf: ["text", { $ref: "#/components/schemas/Gone" }],
      properties: { kept: {}, dropped: "x", list: [], none: null },
    }
    expect(propertyNames(schema, schemas)).toEqual(["kept"])
    expect(propertyNames({ properties: [] }, schemas)).toEqual([])
    expect(propertyNames({ $ref: "#/components/schemas/constructor" }, schemas)).toEqual([])
  })

  it("reads a document without schemas", () => {
    expect(propertyNames({ properties: { a: {} } }, undefined)).toEqual(["a"])
    expect(propertyNames({ $ref: "#/components/schemas/Base" }, undefined)).toEqual([])
  })

  it("follows a chain of $refs no deeper than 32", () => {
    const chain = Object.fromEntries(
      Array.from({ length: 40 }, (_, at) => [
        `S${at}`,
        { $ref: `#/components/schemas/S${at + 1}` },
      ]),
    )
    const deep = { ...chain, S40: { properties: { deep: {} } } }
    expect(propertyNames({ $ref: "#/components/schemas/S9" }, deep)).toEqual(["deep"])
    expect(propertyNames({ $ref: "#/components/schemas/S8" }, deep)).toEqual([])
  })
})
