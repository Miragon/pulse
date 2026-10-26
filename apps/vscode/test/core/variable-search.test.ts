import { BpmnProcessId, type InstanceFilter } from "../../src/contract/index.js"
import { PatchedRuntime } from "../../src/contract/fake/index.js"
import { describe, expect, test } from "vitest"
import { DefinitionPanel } from "../../src/core/panels/definition-panel.js"
import {
  VariableConditionRules,
  type DefinitionView,
  type PanelState,
  type VariableConditionView,
} from "../../src/core/protocol/index.js"
import { panelFixture } from "./support/panel-fixture.js"

const ORDER = BpmnProcessId("pulse-order")
const REVIEW: VariableConditionView = { name: "route", operator: "equals", value: "review" }

function readyView(state: PanelState): DefinitionView {
  if (state.status !== "ready" || state.view.kind !== "definition") {
    throw new Error(`expected a ready definition view, got ${state.status}`)
  }
  return state.view
}

async function openOrder(definition: "order@1" | "order@2") {
  const searched: InstanceFilter[] = []
  const fixture = panelFixture(
    (runtime) =>
      new PatchedRuntime(runtime, {
        searchInstances: (filter, page) => {
          searched.push(filter)
          return runtime.searchInstances(filter, page)
        },
      }),
    { writable: true },
  )
  const definitionId = fixture.world.definitionIds[definition]
  const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId })
  await panel.handle({ type: "ready" })
  return { fixture, panel, searched, view: () => readyView(fixture.lastState()) }
}

describe("the variable condition rules", () => {
  test.each([
    [{ ...REVIEW }, "text"],
    [{ name: "amount", operator: "equals", value: "42" }, "number"],
    [{ name: "amount", operator: "equals", value: "-4.5" }, "number"],
    [{ name: "zip", operator: "equals", value: "01234" }, "text"],
    [{ name: "big", operator: "equals", value: "1e3" }, "text"],
    [{ name: "paid", operator: "equals", value: "true" }, "boolean"],
    [{ name: "paid", operator: "equals", value: "True" }, "text"],
    [{ name: "code", operator: "like", value: "42" }, "text"],
    [{ name: "amount", operator: "greaterThan", value: "abc" }, "number"],
    [{ name: "amount", operator: "lessThan", value: "true" }, "number"],
    [{ name: "code", operator: "equals", value: "42", as: "text" }, "text"],
  ] as const)("reads %o as %s", (condition, type) => {
    expect(VariableConditionRules.typeOf(condition)).toBe(type)
  })

  test.each([
    [REVIEW, 'route = "review"'],
    [{ name: "amount", operator: "greaterThan", value: "100" }, "amount > 100"],
    [{ name: "amount", operator: "lessThan", value: "100" }, "amount < 100"],
    [{ name: "code", operator: "notEquals", value: "42", as: "text" }, 'code ≠ "42"'],
    [{ name: "code", operator: "like", value: "ORD-*" }, 'code matches "ORD-*"'],
    [{ name: "paid", operator: "equals", value: "false" }, "paid = false"],
    [
      { name: "dueAt", operator: "greaterThan", value: "2026-03-15T10:00", as: "date" },
      "dueAt > 2026-03-15 10:00",
    ],
    [{ name: "giftNote", operator: "notEquals", value: "", as: "null" }, "giftNote ≠ null"],
  ] as const)("names %o as %s", (condition, label) => {
    expect(VariableConditionRules.label(condition)).toBe(label)
  })

  test("offers the operators that fit each type", () => {
    expect(VariableConditionRules.operatorsOf("text")).toEqual(["equals", "notEquals", "like"])
    expect(VariableConditionRules.operatorsOf("number")).toEqual([
      "equals",
      "notEquals",
      "greaterThan",
      "lessThan",
    ])
    expect(VariableConditionRules.operatorsOf("boolean")).toEqual(["equals", "notEquals"])
    expect(VariableConditionRules.operatorsOf("date")).toEqual(
      VariableConditionRules.operatorsOf("number"),
    )
    expect(VariableConditionRules.operatorsOf("null")).toEqual(["equals", "notEquals"])
  })

  test.each([
    [{ name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", as: "date" }, true],
    [{ name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00:30", as: "date" }, true],
    [{ name: "dueAt", operator: "lessThan", value: "2026-03-15", as: "date" }, false],
    [{ name: "dueAt", operator: "lessThan", value: "2026-13-45T10:00", as: "date" }, false],
    [{ name: "dueAt", operator: "like", value: "2026-03-15T10:00", as: "date" }, false],
    [{ name: "giftNote", operator: "equals", value: "", as: "null" }, true],
    [{ name: "giftNote", operator: "equals", value: "x", as: "null" }, false],
    [{ name: "giftNote", operator: "greaterThan", value: "", as: "null" }, false],
  ] as const)("lets %o fit: %s", (condition, fits) => {
    expect(VariableConditionRules.fits(condition)).toBe(fits)
  })
})

describe("the definition panel with variable conditions", () => {
  test("searches and counts by them, typed by their value", async () => {
    const opened = await openOrder("order@1")

    await opened.panel.handle({
      type: "filterInstances",
      filter: {
        scope: "all",
        variables: [
          { name: "route", operator: "notEquals", value: "review" },
          { name: "amount", operator: "greaterThan", value: "5" },
        ],
      },
    })

    expect(opened.searched.at(-1)?.variables).toEqual([
      { name: "route", operator: "notEquals", valueJson: '"review"' },
      { name: "amount", operator: "greaterThan", valueJson: "5" },
    ])
    expect(opened.view().instances.map((row) => row.businessKey)).toEqual(["ORD-1002"])
    expect(opened.view().variableLabels).toEqual(['route ≠ "review"', "amount > 5"])
    expect(opened.view().scopeCounts).toEqual({ running: 1, withIncident: 1, ended: 0, all: 1 })
  })

  test("sends a like pattern and a value forced to text as text", async () => {
    const opened = await openOrder("order@1")

    await opened.panel.handle({
      type: "filterInstances",
      filter: {
        scope: "all",
        variables: [
          { name: "route", operator: "like", value: "rev*" },
          { name: "amount", operator: "notEquals", value: "7", as: "text" },
        ],
      },
    })

    expect(opened.searched.at(-1)?.variables).toEqual([
      { name: "route", operator: "like", pattern: "rev*" },
      { name: "amount", operator: "notEquals", valueJson: '"7"' },
    ])
  })

  test("sends a date as a point in time and null as null", async () => {
    const opened = await openOrder("order@1")

    await opened.panel.handle({
      type: "filterInstances",
      filter: {
        scope: "all",
        variables: [
          { name: "dueAt", operator: "greaterThan", value: "2026-01-01T00:00", as: "date" },
          { name: "giftNote", operator: "equals", value: "", as: "null" },
        ],
      },
    })

    expect(opened.searched.at(-1)?.variables).toEqual([
      {
        name: "dueAt",
        operator: "greaterThan",
        at: new Date("2026-01-01T00:00").toISOString(),
      },
      { name: "giftNote", operator: "equals", valueJson: "null" },
    ])
    expect(opened.view().instances.map((row) => row.businessKey)).toEqual(["ORD-1002"])
    expect(opened.view().variableLabels).toEqual(["dueAt > 2026-01-01 00:00", "giftNote = null"])
  })

  test("selects only the running instances the conditions match", async () => {
    const opened = await openOrder("order@1")
    await opened.panel.handle({
      type: "filterInstances",
      filter: { scope: "running", variables: [REVIEW] },
    })

    await opened.panel.handle({ type: "selectMatching" })

    expect(opened.view().selection).toMatchObject({ count: 1, allMatching: true })
  })

  test("keeps the conditions on another version, but not the scope or the element", async () => {
    const opened = await openOrder("order@2")
    await opened.panel.handle({
      type: "filterInstances",
      filter: { scope: "all", elementId: "Activity_ReviewOrder", variables: [REVIEW] },
    })

    await opened.panel.handle({
      type: "selectVersion",
      definitionId: opened.fixture.world.definitionIds["order@1"],
    })

    expect(opened.view().filter).toEqual({ scope: "running", variables: [REVIEW] })
    expect(opened.view().instances.map((row) => row.businessKey)).toEqual(["ORD-1001"])
  })

  test("goes back to the running instances on another version without conditions", async () => {
    const opened = await openOrder("order@2")
    await opened.panel.handle({ type: "filterInstances", filter: { scope: "all" } })

    await opened.panel.handle({
      type: "selectVersion",
      definitionId: opened.fixture.world.definitionIds["order@1"],
    })

    expect(opened.view().filter).toEqual({ scope: "running" })
  })
})
