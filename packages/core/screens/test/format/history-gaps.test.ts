import { describe, expect, test } from "vitest"
import { HistoryGaps, type ScopeCountsData } from "../../src/index.js"

const counts = (running: number, ended: number, more: Partial<ScopeCountsData> = {}) => ({
  running,
  withIncident: 0,
  ended,
  all: running + ended,
  ...more,
})

describe("the history of a version that misses instances its runtime runs", () => {
  test("is found where the history counts fewer instances in every lifecycle than run", () => {
    expect(HistoryGaps.of({ running: 2 }, { scope: "running" }, counts(0, 0))).toEqual({
      running: 2,
      counted: 0,
    })
    expect(HistoryGaps.of({ running: 5 }, { scope: "ended" }, counts(1, 3))).toEqual({
      running: 5,
      counted: 4,
    })
  })

  test("is none where the history holds as many or more, ended ones among them", () => {
    expect(HistoryGaps.of({ running: 2 }, { scope: "all" }, counts(2, 0))).toBeUndefined()
    expect(HistoryGaps.of({ running: 2 }, { scope: "all" }, counts(1, 1))).toBeUndefined()
    expect(HistoryGaps.of({ running: 0 }, { scope: "running" }, counts(0, 0))).toBeUndefined()
  })

  test("says nothing over counts a filter narrows, which no longer count the version whole", () => {
    const empty = counts(0, 0)
    expect(HistoryGaps.of({ running: 2 }, { scope: "all", elementId: "a" }, empty)).toBeUndefined()
    expect(
      HistoryGaps.of({ running: 2 }, { scope: "all", businessKey: "ORD-1" }, empty),
    ).toBeUndefined()
    expect(
      HistoryGaps.of(
        { running: 2 },
        { scope: "all", variables: [{ name: "a", operator: "equals", value: "1" }] },
        empty,
      ),
    ).toBeUndefined()
  })

  test("says nothing without counts, or over a count the engine stopped at", () => {
    expect(HistoryGaps.of({ running: 2 }, { scope: "running" }, null)).toBeUndefined()
    expect(
      HistoryGaps.of(
        { running: 20_000 },
        { scope: "running" },
        counts(10_000, 0, { atLeast: ["all"] }),
      ),
    ).toBeUndefined()
    expect(
      HistoryGaps.of({ running: 2 }, { scope: "running" }, counts(0, 0, { atLeast: ["ended"] })),
    ).toEqual({ running: 2, counted: 0 })
  })
})
