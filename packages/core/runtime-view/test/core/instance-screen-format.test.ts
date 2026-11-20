import type {
  HeadlineData,
  PathRowData,
  VariableRowData,
  WaitRowData,
} from "@miragon/pulse-screens"
import { describe, expectTypeOf, test } from "vitest"
import type { InstanceHead, PathRow, VariableRow, WaitRow } from "../../src/core/protocol/index.js"

type WaitFacts =
  "assignee" | "taskType" | "retriesLeft" | "messageName" | "signalName" | "description"

describe("the instance view of the protocol", () => {
  test("copies the head strips the editors show from the screens' codes, without importing them", () => {
    expectTypeOf<InstanceHead>().toExtend<HeadlineData>()
    expectTypeOf<InstanceHead["code"]>().toEqualTypeOf<"incidents" | "suspended" | "ended">()
  })

  test("carries the screens' JSON form of a run, a wait's facts and a variable beside its words", () => {
    expectTypeOf<Pick<PathRow, "elementId" | "startedAt" | "state" | "durationMs">>().toEqualTypeOf<
      Pick<PathRowData, "elementId" | "startedAt" | "state" | "durationMs">
    >()
    expectTypeOf<Pick<WaitRow, WaitFacts>>().toEqualTypeOf<Pick<WaitRowData, WaitFacts>>()
    expectTypeOf<
      Pick<VariableRow, "name" | "valueJson" | "truncated" | "scopeElementId" | "type">
    >().toEqualTypeOf<
      Pick<VariableRowData, "name" | "valueJson" | "truncated" | "scopeElementId" | "type">
    >()
  })
})
