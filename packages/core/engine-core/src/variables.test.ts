import { describe, expect, it } from "vitest"
import { historicVariableMap, plainVariables } from "./variables.js"

describe("plainVariables", () => {
  it("flattens scalar types, keeps the others typed and sorts by name", () => {
    const map = JSON.parse(
      JSON.stringify({
        text: { type: "String", value: "x", valueInfo: {} },
        amount: { type: "Integer", value: 5 },
        none: { type: "Null", value: null },
        empty: { type: "Long" },
        json: { type: "Json", value: "{}", valueInfo: {} },
        file: { type: "File", value: null, valueInfo: { filename: "a.txt" } },
        raw: 7,
        untyped: {},
      }),
    ) as unknown
    expect(plainVariables(map)).toEqual({
      amount: 5,
      empty: null,
      file: { type: "File", value: null, valueInfo: { filename: "a.txt" } },
      json: { type: "Json", value: "{}" },
      none: null,
      raw: 7,
      text: "x",
      untyped: { type: "", value: null },
    })
    expect(Object.keys(plainVariables(map))).toEqual([
      "amount",
      "empty",
      "file",
      "json",
      "none",
      "raw",
      "text",
      "untyped",
    ])
    expect(plainVariables(null)).toEqual({})
  })
})

describe("historicVariableMap", () => {
  it("keeps the rows of the process scope as a variable map", () => {
    expect(
      historicVariableMap(
        [
          { name: "a", type: "Integer", value: 1, activityInstanceId: "p1" },
          { name: "b", type: "String", value: "x", activityInstanceId: "task:1" },
          { type: "String", value: "nameless", activityInstanceId: "p1" },
        ],
        "p1",
      ),
    ).toEqual({ a: { type: "Integer", value: 1, valueInfo: undefined } })
  })
})
