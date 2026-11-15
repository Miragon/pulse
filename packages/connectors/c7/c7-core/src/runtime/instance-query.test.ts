import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  IsoTimestamp,
  type VariableCondition,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { historicQueryOf, incidentScopeOf, runtimeKnowsWhole } from "./instance-query.js"

function variablesOf(conditions: readonly VariableCondition[]): string {
  return JSON.stringify(historicQueryOf({ variables: conditions }).variables)
}

describe("historicQueryOf", () => {
  it("names every filter in the history's words, in the order the engine is sent them", () => {
    const query = historicQueryOf({
      lifecycle: "running",
      variables: [{ name: "amount", operator: "greaterThan", valueJson: "100" }],
      activeElementId: ElementId("Activity_Review"),
      businessKey: "ORD-1",
      instanceIds: [InstanceId("p1"), InstanceId("p2")],
      bpmnProcessId: BpmnProcessId("order"),
      definitionId: DefinitionId("order:1:a"),
      withIncident: true,
    })
    expect(JSON.stringify(query)).toBe(
      '{"processDefinitionId":"order:1:a","processDefinitionKey":"order","processInstanceIds":["p1","p2"],"processInstanceBusinessKey":"ORD-1","unfinished":true,"activityIdIn":["Activity_Review"],"variables":[{"name":"amount","operator":"gt","value":100}]}',
    )
  })

  it("asks for the ended instances only when the filter does", () => {
    expect(historicQueryOf({ lifecycle: "ended" })).toStrictEqual({ finished: true })
  })

  it("asks for nothing without a filter", () => {
    expect(historicQueryOf({})).toStrictEqual({})
  })

  it.each([
    ["equals", "eq"],
    ["notEquals", "neq"],
    ["greaterThan", "gt"],
    ["lessThan", "lt"],
  ] as const)("maps %s to %s with the typed value", (operator, engineOperator) => {
    expect(variablesOf([{ name: "amount", operator, valueJson: "42" }])).toBe(
      `[{"name":"amount","operator":"${engineOperator}","value":42}]`,
    )
  })

  it("sends a date in the engine's date format, in UTC", () => {
    expect(
      variablesOf([
        { name: "dueAt", operator: "lessThan", at: IsoTimestamp("2026-03-15T11:00:00+01:00") },
      ]),
    ).toBe('[{"name":"dueAt","operator":"lt","value":"2026-03-15T10:00:00.000+0000"}]')
  })

  it("sends an integer beyond 2^53 exactly", () => {
    expect(
      variablesOf([{ name: "orderNumber", operator: "equals", valueJson: "9007199254740993" }]),
    ).toBe('[{"name":"orderNumber","operator":"eq","value":9007199254740993}]')
  })

  it.each([
    ["an object", '{"a": 9007199254740993}', '{"a":9007199254740993}'],
    ["an array", "[1.50, -9007199254740993]", "[1.5,-9007199254740993]"],
  ])("sends an integer beyond 2^53 in %s exactly", (_name, valueJson, written) => {
    expect(variablesOf([{ name: "order", operator: "equals", valueJson }])).toBe(
      `[{"name":"order","operator":"eq","value":${written}}]`,
    )
  })

  it("sends a number as the engine always read it, not as typed", () => {
    expect(variablesOf([{ name: "amount", operator: "lessThan", valueJson: "1.50" }])).toBe(
      '[{"name":"amount","operator":"lt","value":1.5}]',
    )
  })

  it("turns * into the engine wildcard and escapes the engine's own wildcards", () => {
    expect(
      historicQueryOf({ variables: [{ name: "code", operator: "like", pattern: "A*_5%\\b*" }] })
        .variables,
    ).toStrictEqual([{ name: "code", operator: "like", value: "A%\\_5\\%\\\\b%" }])
  })
})

describe("incidentScopeOf", () => {
  it("is the filter's version, process and business key", () => {
    expect(
      incidentScopeOf({
        businessKey: "ORD-1",
        bpmnProcessId: BpmnProcessId("order"),
        definitionId: DefinitionId("order:1:a"),
        lifecycle: "running",
      }),
    ).toStrictEqual({
      processDefinitionId: "order:1:a",
      processDefinitionKey: "order",
      businessKey: "ORD-1",
    })
  })

  it("is the whole engine without them", () => {
    expect(incidentScopeOf({ withIncident: true })).toStrictEqual({})
  })
})

describe("runtimeKnowsWhole", () => {
  it.each([
    ["no filter", {}],
    ["running instances of a version", { lifecycle: "running", definitionId: DefinitionId("o:1") }],
    ["no variable condition", { variables: [] }],
  ] as const)("is true for %s", (_name, filter) => {
    expect(runtimeKnowsWhole(filter)).toBe(true)
  })

  it.each([
    ["ended instances", { lifecycle: "ended" }],
    ["given ids", { instanceIds: [] }],
    ["an element", { activeElementId: ElementId("Activity_Review") }],
    ["a variable condition", { variables: [{ name: "a", operator: "like", pattern: "x" }] }],
  ] as const)("is false for %s", (_name, filter) => {
    expect(runtimeKnowsWhole(filter)).toBe(false)
  })
})
