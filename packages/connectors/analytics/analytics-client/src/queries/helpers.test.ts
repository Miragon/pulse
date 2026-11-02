import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { increaseIn } from "./helpers.js"
import { DAY_SECONDS, rangeSeconds } from "./windows.js"

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)
const NOW_SECONDS = NOW / 1000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("increaseIn", () => {
  it("counts a series born inside the window with its whole value", () => {
    expect(increaseIn('engine_x_total{engine_id="a"}', { range: "7d" })).toBe(
      '((increase(engine_x_total{engine_id="a"}[7d]) and present_over_time(engine_x_total{engine_id="a"}[1h] offset 7d))' +
        ' or (max_over_time(engine_x_total{engine_id="a"}[7d]) unless present_over_time(engine_x_total{engine_id="a"}[1h] offset 7d)))',
    )
  })

  it("pins every part of a window that ends in the past", () => {
    const at = NOW_SECONDS - 3 * DAY_SECONDS
    expect(increaseIn("engine_x_total", { range: "86400s", at })).toBe(
      `((increase(engine_x_total[86400s] @ ${at}) and present_over_time(engine_x_total[1h] @ ${at} offset 86400s))` +
        ` or (max_over_time(engine_x_total[86400s] @ ${at}) unless present_over_time(engine_x_total[1h] @ ${at} offset 86400s)))`,
    )
  })

  it("checks the window's first hour where the hour before it lies past the retention", () => {
    // 30 days back reaches the retention edge: the series silent in the window's
    // first hour (30d − 1h = 2588400s before its end) were born inside it.
    expect(increaseIn("engine_x_total", { range: "30d" })).toBe(
      "((increase(engine_x_total[30d]) and present_over_time(engine_x_total[1h] offset 2588400s))" +
        " or (max_over_time(engine_x_total[30d]) unless present_over_time(engine_x_total[1h] offset 2588400s)))",
    )
    const at = NOW_SECONDS - 29 * DAY_SECONDS
    expect(increaseIn("engine_x_total", { range: "1d", at })).toContain(
      `present_over_time(engine_x_total[1h] @ ${at} offset 82800s)`,
    )
    // The hour before the window starts exactly at the retention edge: still that hour.
    const edge = NOW_SECONDS - 30 * DAY_SECONDS + 3600 + DAY_SECONDS
    expect(increaseIn("engine_x_total", { range: "1d", at: edge })).toContain(
      `present_over_time(engine_x_total[1h] @ ${edge} offset 1d)`,
    )
    expect(increaseIn("engine_x_total", { range: "1d", at: edge - 1 })).toContain(
      `present_over_time(engine_x_total[1h] @ ${edge - 1} offset 82800s)`,
    )
  })

  it("reads plain increase() for a window of an hour or less at the retention edge", () => {
    const at = NOW_SECONDS - 30 * DAY_SECONDS + 1800
    expect(increaseIn("engine_x_total", { range: "3600s", at })).toBe(
      `increase(engine_x_total[3600s] @ ${at})`,
    )
  })

  it("refuses a range it cannot measure", () => {
    expect(() => increaseIn("engine_x_total", { range: "1d12h" })).toThrow(/single-unit/)
  })
})

describe("rangeSeconds", () => {
  it("measures every single-unit PromQL duration", () => {
    expect(["30s", "5m", "2h", "1d", "1w"].map(rangeSeconds)).toEqual([
      30,
      300,
      7200,
      DAY_SECONDS,
      7 * DAY_SECONDS,
    ])
  })
})
