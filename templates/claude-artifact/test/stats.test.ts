import { describe, expect, it } from "vitest"
import {
  countPerDay,
  dayStarts,
  daysBefore,
  parseEngineDate,
  quantile,
  tally,
} from "../src/data/stats.ts"

describe("engine dates", () => {
  it("parses the engine's offset without a colon", () => {
    expect(parseEngineDate("2026-10-09T13:40:02.112+0000")?.toISOString()).toBe(
      "2026-10-09T13:40:02.112Z",
    )
    expect(parseEngineDate("2026-10-09T15:40:02.112+0200")?.toISOString()).toBe(
      "2026-10-09T13:40:02.112Z",
    )
    expect(parseEngineDate(null)).toBeNull()
    expect(parseEngineDate("soon")).toBeNull()
  })

  it("steps back by instants, the same in every time zone", () => {
    expect(daysBefore(new Date("2026-11-24T12:00:00.000Z"), 15).toISOString()).toBe(
      "2026-11-09T12:00:00.000Z",
    )
  })
})

describe("the viewer's days", () => {
  const now = new Date(2026, 10, 24, 15, 30)

  it("starts each of the last days at the viewer's midnight, today last", () => {
    const starts = dayStarts(now, 14)
    expect(starts).toHaveLength(14)
    expect(starts[13]).toEqual(new Date(2026, 10, 24))
    expect(starts[0]).toEqual(new Date(2026, 10, 11))
    expect(starts.every((start) => start.getHours() === 0)).toBe(true)
  })

  it("buckets times by the day they fall on; earlier times and missing ones count nowhere", () => {
    const starts = dayStarts(now, 3)
    const at = (d: number, h: number) => new Date(2026, 10, d, h)
    expect(
      countPerDay([at(22, 0), at(22, 23), at(23, 12), at(24, 9), at(21, 23), null], starts),
    ).toEqual([2, 1, 1])
  })

  it("the window one day longer than the days shown holds the oldest day whole", () => {
    const starts = dayStarts(now, 14)
    expect(daysBefore(now, 15).getTime()).toBeLessThanOrEqual(starts[0].getTime())
  })
})

describe("quantiles and tallies", () => {
  it("takes the nearest rank: a value that occurred", () => {
    const values = [5, 1, 3, 2, 4, 10, 9, 8, 7, 6]
    expect(quantile(values, 0.5)).toBe(5)
    expect(quantile(values, 0.9)).toBe(9)
    expect(quantile([7], 0.9)).toBe(7)
    expect(quantile([], 0.5)).toBeNull()
  })

  it("counts keys, the largest first", () => {
    expect(tally(["b", "a", "b", "c", "a", "b"])).toEqual([
      { key: "b", count: 3 },
      { key: "a", count: 2 },
      { key: "c", count: 1 },
    ])
  })
})
