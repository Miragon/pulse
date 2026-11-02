import { describe, expect, it } from "vitest"
import { durationOutliers, OUTLIER_FLOOR_MS } from "./duration-outliers.js"

describe("durationOutliers", () => {
  it("offers nothing for an instance of near-instant steps (a median of 0)", () => {
    const isOutlier = durationOutliers([0, 0, 0, 3, 12, null])
    expect([0, 3, 12].filter(isOutlier)).toEqual([])
  })

  it("offers the slowest step and every step at twice the median, from the floor on", () => {
    const isOutlier = durationOutliers([1_200, 1_500, 2_000, 4_000, 9_000, null])
    expect([1_200, 1_500, 2_000, 4_000, 9_000].filter(isOutlier)).toEqual([4_000, 9_000])
    expect(isOutlier(null)).toBe(false)
  })

  it("never offers a step under the floor, not even the slowest", () => {
    const isOutlier = durationOutliers([10, 20, OUTLIER_FLOOR_MS - 1])
    expect(isOutlier(OUTLIER_FLOOR_MS - 1)).toBe(false)
  })

  it("offers nothing without a completed step", () => {
    expect(durationOutliers([null, undefined])(5_000)).toBe(false)
  })
})
