import type { InstanceListFilterData } from "@miragon/pulse-screens"
import { describe, expect, it } from "vitest"
import { InstanceFilters } from "./instance-filters.js"

const ROUTE = { name: "route", operator: "equals", value: "review" } as const
const AMOUNT = { name: "amount", operator: "greaterThan", value: "100" } as const

const FULL: InstanceListFilterData = {
  scope: "running",
  elementId: "Activity_CheckCredit",
  businessKey: "ORD-1",
  variables: [ROUTE],
}

describe("the filters an instance list asks for", () => {
  it("change the scope and keep the rest", () => {
    expect(InstanceFilters.withScope(FULL, "ended")).toEqual({ ...FULL, scope: "ended" })
  })

  it("filter to an element, with the scope of a badge's count or the one shown, and back", () => {
    expect(InstanceFilters.withElement({ scope: "all" }, "Activity_Ship")).toEqual({
      scope: "all",
      elementId: "Activity_Ship",
    })
    expect(InstanceFilters.withElement(FULL, "Activity_Ship", "withIncident")).toEqual({
      ...FULL,
      scope: "withIncident",
      elementId: "Activity_Ship",
    })
    expect(InstanceFilters.withoutElement(FULL)).toEqual({
      scope: "running",
      businessKey: "ORD-1",
      variables: [ROUTE],
    })
  })

  it("search the exact business key, trimmed, and drop an empty one", () => {
    expect(InstanceFilters.withBusinessKey({ scope: "all" }, "  ORD-2 ")).toEqual({
      scope: "all",
      businessKey: "ORD-2",
    })
    expect(InstanceFilters.withBusinessKey(FULL, " ")).toEqual({
      scope: "running",
      elementId: "Activity_CheckCredit",
      variables: [ROUTE],
    })
  })

  it("add a condition, replace one, remove one and remove them all", () => {
    expect(InstanceFilters.withVariable({ scope: "all" }, ROUTE)).toEqual({
      scope: "all",
      variables: [ROUTE],
    })
    expect(InstanceFilters.withVariable(FULL, AMOUNT).variables).toEqual([ROUTE, AMOUNT])
    expect(InstanceFilters.withVariable(FULL, AMOUNT, 0).variables).toEqual([AMOUNT])
    expect(InstanceFilters.withoutVariable({ ...FULL, variables: [ROUTE, AMOUNT] }, 0)).toEqual({
      ...FULL,
      variables: [AMOUNT],
    })
    expect(InstanceFilters.withoutVariable(FULL, 0)).toEqual({
      scope: "running",
      elementId: "Activity_CheckCredit",
      businessKey: "ORD-1",
    })
    expect(InstanceFilters.withoutVariable({ scope: "all" }, 0)).toEqual({ scope: "all" })
    expect(InstanceFilters.withoutVariables(FULL)).toEqual({
      scope: "running",
      elementId: "Activity_CheckCredit",
      businessKey: "ORD-1",
    })
  })
})
