import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import { rawJson } from "../raw-json.js"
import {
  inspectedVariablesOf,
  readVariableInstances,
  VARIABLE_PAGE_SIZE,
} from "./variable-instances.js"

const BEYOND_2_53 = "9007199254740993"

function row(name: string, activityInstanceId: string, fields: Record<string, unknown> = {}) {
  return {
    name,
    type: "String",
    value: name,
    activityInstanceId,
    processInstanceId: "p1",
    ...fields,
  }
}

function readOver(answer: unknown) {
  const port = fakePort({ getVariableInstances: () => answer })
  return { port, rows: readVariableInstances(port, "p1") }
}

describe("readVariableInstances", () => {
  it("asks for the first 500 variables of every scope with values left serialized", async () => {
    const { port, rows } = readOver([])

    expect(await rows).toStrictEqual([])
    expect(VARIABLE_PAGE_SIZE).toBe(500)
    expect(port.calls).toStrictEqual([
      {
        operationId: "getVariableInstances",
        input: {
          pathArgs: [],
          query: { processInstanceIdIn: "p1", deserializeValues: "false", maxResults: "500" },
        },
      },
    ])
    expect(Object.keys(port.calls[0]?.input.query ?? {})).toStrictEqual([
      "processInstanceIdIn",
      "deserializeValues",
      "maxResults",
    ])
  })

  it("reads each variable with its value as JSON text, its type and the element it is local to", async () => {
    const { rows } = readOver([
      row("route", "p1"),
      row("note", "Activity_Review:a1", { type: "Json", value: '{"a":1}' }),
      row("count", "Activity_Pack#multiInstanceBody:a2", { type: "Integer", value: 2 }),
      row("plain", "Activity_Plain", { type: null, value: [1, "two"] }),
    ])

    expect(await rows).toStrictEqual([
      { name: "route", valueJson: '"route"', type: "String" },
      { name: "note", valueJson: '"{\\"a\\":1}"', type: "Json", scopeElementId: "Activity_Review" },
      { name: "count", valueJson: "2", type: "Integer", scopeElementId: "Activity_Pack" },
      { name: "plain", valueJson: '[1,"two"]', scopeElementId: "Activity_Plain" },
    ])
  })

  it.each([
    ["absent", {}],
    ["null", { value: null }],
  ])("writes a value that is %s as null", async (_name, value) => {
    const { name, activityInstanceId, processInstanceId } = row("empty", "p1")
    const { rows } = readOver([{ name, activityInstanceId, processInstanceId, ...value }])

    expect(await rows).toStrictEqual([{ name: "empty", valueJson: "null" }])
  })

  it("keeps an integer beyond 2^53 the wire kept as raw JSON digit for digit", async () => {
    const { rows } = readOver([row("ledger", "p1", { type: "Long", value: rawJson(BEYOND_2_53) })])

    expect((await rows)[0]?.valueJson).toBe(BEYOND_2_53)
  })

  it.each([
    ["no list", { variables: [] }, "variable instances is not a list"],
    ["a variable without a name", [row("x", "p1", { name: undefined })], "name is missing"],
    [
      "a scope without its instance",
      [row("x", "p1", { processInstanceId: null })],
      "processInstanceId is missing",
    ],
    [
      "a variable without a scope",
      [row("x", "p1", { activityInstanceId: 7 })],
      "activityInstanceId is not a string",
    ],
  ])("fails on %s as an unexpected answer", async (_name, answer, message) => {
    const { rows } = readOver(answer)
    const error = await rows.catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })
})

describe("inspectedVariablesOf", () => {
  it("keeps the variable views of the inspection's map, typed or plain", () => {
    expect(
      inspectedVariablesOf({
        untyped: { value: "x" },
        json: { type: "Json" },
        blank: { type: "", value: 1 },
        plain: 7,
        flat: "text",
        list: [1, 2],
        none: null,
        typedNull: { type: "Null", value: null },
      }),
    ).toStrictEqual([
      { name: "untyped", valueJson: '{"value":"x"}' },
      { name: "json", valueJson: "null", type: "Json" },
      { name: "blank", valueJson: "1" },
      { name: "plain", valueJson: "7" },
      { name: "flat", valueJson: '"text"' },
      { name: "list", valueJson: "[1,2]" },
      { name: "none", valueJson: "null" },
      { name: "typedNull", valueJson: "null", type: "Null" },
    ])
  })

  it("reads a type that is no text as a plain value", () => {
    expect(inspectedVariablesOf({ odd: { type: 7, value: "x" } })).toStrictEqual([
      { name: "odd", valueJson: '{"type":7,"value":"x"}' },
    ])
  })

  it("keeps an integer beyond 2^53, flat or typed, digit for digit", () => {
    expect(
      inspectedVariablesOf({
        total: rawJson(BEYOND_2_53),
        typed: { type: "Long", value: rawJson(BEYOND_2_53) },
      }),
    ).toStrictEqual([
      { name: "total", valueJson: BEYOND_2_53 },
      { name: "typed", valueJson: BEYOND_2_53, type: "Long" },
    ])
  })

  it("has none without a map", () => {
    expect(inspectedVariablesOf(undefined)).toStrictEqual([])
    expect(inspectedVariablesOf({})).toStrictEqual([])
  })
})
