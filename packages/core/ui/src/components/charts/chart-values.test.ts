import { afterEach, describe, expect, it } from "vitest"
import { setFormatLocale } from "../../format/index.js"
import { UI_MESSAGES } from "../../locale/ui-messages.js"
import { boundOf, maxOf, niceTicks, percentText, tickText, valueText } from "./chart-values.js"

const NBSP = " "

afterEach(() => {
  setFormatLocale(undefined)
})

describe("niceTicks", () => {
  it("runs from zero in round steps up to the first tick at or above the top value", () => {
    expect(niceTicks(87, "count", 3)).toEqual([0, 50, 100])
    expect(niceTicks(120, "count", 3)).toEqual([0, 50, 100, 150])
    expect(niceTicks(9, "count", 4)).toEqual([0, 5, 10])
    expect(niceTicks(4321, "count", 4)).toEqual([0, 2000, 4000, 6000])
  })

  it("counts in whole steps and keeps one step where nothing is above zero", () => {
    expect(niceTicks(3, "count", 5)).toEqual([0, 1, 2, 3])
    expect(niceTicks(0, "count", 3)).toEqual([0, 1])
    expect(niceTicks(Number.NaN, "count", 3)).toEqual([0, 1])
  })

  it("steps durations in whole units and shares in round percentages", () => {
    expect(niceTicks(150_000, "duration", 3)).toEqual([0, 60_000, 120_000, 180_000])
    expect(niceTicks(2 * 3_600_000 + 1, "duration", 3)).toEqual([
      0, 3_600_000, 7_200_000, 10_800_000,
    ])
    expect(niceTicks(1.3, "percent", 3)).toEqual([0, 0.5, 1, 1.5])
    expect(niceTicks(0.3, "percent", 3)).toEqual([0, 0.1, 0.2, 0.3])
  })

  it("never lets a value run past the top tick", () => {
    for (const max of [1, 7, 13, 99, 101, 999, 12_345, 9_999_999]) {
      const ticks = niceTicks(max, "count", 3)
      expect(ticks.at(-1), String(max)).toBeGreaterThanOrEqual(max)
      expect(ticks.length, String(max)).toBeLessThanOrEqual(7)
    }
  })
})

describe("a value in words and on screen", () => {
  const words = UI_MESSAGES.en

  it("draws an exact count and a lower bound's bound, nothing for no value", () => {
    expect(boundOf(12)).toBe(12)
    expect(boundOf({ atLeast: 2000 })).toBe(2000)
    expect(boundOf(null)).toBeNull()
    expect(boundOf(undefined)).toBeNull()
    expect(boundOf(Number.NaN)).toBeNull()
    expect(maxOf([3, { atLeast: 9 }, null, 4])).toBe(9)
    expect(maxOf([null, undefined])).toBe(0)
  })

  it("says a count as TabCount does, in the kit's locale", () => {
    expect(valueText(1234, "count", words, "en")).toEqual({ shown: "1,234", spoken: "1,234" })
    expect(valueText({ atLeast: 2000 }, "count", words, "en")).toEqual({
      shown: `≥${NBSP}2,000`,
      spoken: "at least 2,000",
    })
    expect(valueText(null, "count", words, "en")).toEqual({ shown: "—", spoken: "count unknown" })
    expect(valueText(1234, "count", UI_MESSAGES.de, "de").shown).toBe("1.234")
  })

  it("says a duration and a share through their formatters, no value in words", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(valueText(187_000, "duration", words, "en")).toEqual({
      shown: "3m 7s",
      spoken: "3m 7s",
    })
    expect(valueText({ atLeast: 60_000 }, "duration", words, "en")).toEqual({
      shown: `≥${NBSP}1m 0s`,
      spoken: "at least 1m 0s",
    })
    expect(valueText(null, "duration", words, "en")).toEqual({ shown: "—", spoken: "no value" })
    expect(valueText(37.5, "percent", words, "en").shown).toBe("37.5%")
    expect(valueText(null, "percent", UI_MESSAGES.de, "de").spoken).toBe("kein Wert")
  })

  it("never says a share that is not zero as 0 %, on screen or in words", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(valueText(0.03, "percent", words, "en")).toEqual({ shown: "0.03%", spoken: "0.03%" })
    expect(valueText(0.04, "percent", words, "en").shown).toBe("0.04%")
    expect(valueText({ atLeast: 0.002 }, "percent", words, "en")).toEqual({
      shown: `≥${NBSP}0.002%`,
      spoken: "at least 0.002%",
    })
    expect(valueText(0, "percent", words, "en").shown).toBe("0%")
  })
})

describe("percentText", () => {
  it("adds the digits that keep a part from reading as none or as all, no more", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(percentText(37.5, 1)).toBe("37.5%")
    expect(percentText(42, 0)).toBe("42%")
    expect(percentText(0.0333, 1)).toBe("0.03%")
    expect(percentText(0.0004, 1)).toBe("0.0004%")
    expect(percentText(99.9667, 0)).toBe("99.97%")
    expect(percentText(99.96, 1)).toBe("99.96%")
    expect(percentText(0, 1)).toBe("0%")
    expect(percentText(100, 0)).toBe("100%")
  })
})

describe("tickText", () => {
  it("writes counts in full under ten thousand and compact on an axis that reaches it", () => {
    expect(tickText(5000, "count", [0, 5000, 10_000], "en")).toBe("5k")
    expect(tickText(5000, "count", [0, 2500, 5000, 7500], "en")).toBe("5,000")
  })

  it("writes a share with a decimal only where the steps are below a whole percent", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(tickText(0.5, "percent", [0, 0.5, 1], "en")).toBe("0.5%")
    expect(tickText(50, "percent", [0, 25, 50], "en")).toBe("50%")
    expect(tickText(120_000, "duration", [0, 60_000, 120_000], "en")).toBe("2m 0s")
  })

  it.each([0.07, 0.12, 0.03, 0.003])(
    "labels every tick apart on a percent axis that peaks at %s, below a whole percent",
    (peak) => {
      setFormatLocale({ language: "en", locale: "en-US" })
      for (const intervals of [2, 3, 4, 5]) {
        const ticks = niceTicks(peak, "percent", intervals)
        const labels = ticks.map((tick) => tickText(tick, "percent", ticks, "en"))
        expect(new Set(labels).size, labels.join(" ")).toBe(labels.length)
        expect(labels.slice(1), labels.join(" ")).not.toContain("0%")
      }
    },
  )

  it("writes the step's digits on a percent axis below 1 %", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    const ticks = niceTicks(0.07, "percent", 2)
    expect(ticks.map((tick) => tickText(tick, "percent", ticks, "en"))).toEqual([
      "0%",
      "0.05%",
      "0.1%",
    ])
  })
})
