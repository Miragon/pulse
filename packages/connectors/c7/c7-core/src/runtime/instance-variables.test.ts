import type { InstanceState } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { variablesOf } from "./instance-variables.js"
import type { VariableRow } from "./variable-instances.js"

const INSPECTED = { route: { type: "String", value: "review" } }
const TYPED: readonly VariableRow[] = [{ name: "amount", valueJson: "250", type: "Integer" }]

function only(row: VariableRow) {
  return variablesOf("running", undefined, [row])[0]
}

describe("variablesOf", () => {
  it("takes the typed variables of every scope while the instance runs", () => {
    expect(variablesOf("running", INSPECTED, TYPED)).toStrictEqual([
      {
        name: "amount",
        scope: { kind: "instance" },
        valueJson: "250",
        truncated: false,
        kind: "integer",
        type: "Integer",
      },
    ])
  })

  it.each<[string, InstanceState, readonly VariableRow[] | undefined]>([
    ["runs but its typed variables could not be read", "running", undefined],
    ["is suspended", "suspended", TYPED],
    ["has completed", "completed", TYPED],
  ])("takes the inspection's variables when the instance %s", (_name, state, typed) => {
    expect(variablesOf(state, INSPECTED, typed)).toStrictEqual([
      {
        name: "route",
        scope: { kind: "instance" },
        valueJson: '"review"',
        truncated: false,
        kind: "string",
        type: "String",
      },
    ])
  })

  it("has none without typed variables or a map", () => {
    expect(variablesOf("completed", undefined, undefined)).toStrictEqual([])
  })

  it("names the element a local variable belongs to", () => {
    expect(
      only({ name: "note", valueJson: '"x"', scopeElementId: "Activity_Review" })?.scope,
    ).toStrictEqual({
      kind: "element",
      elementId: "Activity_Review",
    })
  })

  it("shows the JSON a Json variable holds, and its text when it holds none", () => {
    expect(
      only({ name: "a", valueJson: '"{\\"city\\":\\"Munich\\"}"', type: "Json" }),
    ).toMatchObject({
      valueJson: '{"city":"Munich"}',
      kind: "json",
    })
    expect(only({ name: "a", valueJson: "null", type: "Json" })?.valueJson).toBe("null")
    expect(only({ name: "a", valueJson: '"{}"', type: "String" })?.valueJson).toBe('"{}"')
  })

  it.each([
    ["String", "string"],
    ["Short", "integer"],
    ["Integer", "integer"],
    ["Long", "integer"],
    ["Double", "decimal"],
    ["Boolean", "boolean"],
    ["Date", "date"],
    ["Json", "json"],
    ["Null", "null"],
    ["Object", "opaque"],
    ["Bytes", "opaque"],
    ["string", "opaque"],
  ])("reads the engine type %s as %s", (type, kind) => {
    expect(only({ name: "a", valueJson: "null", type })).toMatchObject({ kind, type })
  })

  it("reads the kind of a value without a type from its JSON", () => {
    const untyped = (valueJson: string) => only({ name: "a", valueJson })

    expect(untyped("7")).toStrictEqual({
      name: "a",
      scope: { kind: "instance" },
      valueJson: "7",
      truncated: false,
      kind: "integer",
    })
    expect(untyped('"x"')?.kind).toBe("string")
    expect(untyped('{"a":1}')?.kind).toBe("json")
  })

  it("orders the variables by name as the editors always showed them", () => {
    const rows = ["b", "B", "a", "A", "_c"].map((name) => ({ name, valueJson: "1" }))

    expect(variablesOf("running", undefined, rows).map((variable) => variable.name)).toStrictEqual([
      "_c",
      "a",
      "A",
      "b",
      "B",
    ])
  })
})
