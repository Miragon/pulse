import { afterEach, describe, expect, it, vi } from "vitest"
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  formatTime,
  formatTimestamp,
  getFormatLocale,
  setFormatLocale,
  subscribeFormatLocale,
  truncate,
} from "./format.js"

const EMPTY = "—"

afterEach(() => setFormatLocale(undefined))

describe("the published format locale (set by the shell's ProfileGate)", () => {
  const iso = "2026-07-22T22:15:30.000Z"

  it("renders every date helper in the published locale and time zone, not the browser's", () => {
    setFormatLocale({ language: "de", locale: "de-AT", timeZone: "Asia/Tokyo" })
    const date = new Date(iso)
    expect(formatTimestamp(iso)).toBe(date.toLocaleString("de-AT", { timeZone: "Asia/Tokyo" }))
    expect(formatDate(iso)).toBe(date.toLocaleDateString("de-AT", { timeZone: "Asia/Tokyo" }))
    expect(formatTime(iso)).toBe(date.toLocaleTimeString("de-AT", { timeZone: "Asia/Tokyo" }))
    expect(formatTime(iso, { seconds: false })).toBe(
      date.toLocaleTimeString("de-AT", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }),
    )
    // The zone moves the calendar day: 22:15 UTC is already the 23rd in Tokyo.
    expect(formatDate(iso)).toContain("23")
  })

  it("keeps the browser's zone when none is published", () => {
    setFormatLocale({ language: "en", locale: "en-GB" })
    expect(formatTimestamp(iso)).toBe(new Date(iso).toLocaleString("en-GB"))
  })

  it("notifies subscribers on a real change only, and stops after unsubscribe", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeFormatLocale(listener)
    setFormatLocale({ language: "de", locale: "de" })
    setFormatLocale({ language: "de", locale: "de" })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getFormatLocale()).toEqual({ language: "de", locale: "de" })

    setFormatLocale({ language: "de", locale: "de", timeZone: "Europe/Berlin" })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    setFormatLocale(undefined)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getFormatLocale()).toBeUndefined()
  })
})

describe("formatTimestamp / formatDate / formatTime", () => {
  it("renders a valid ISO timestamp", () => {
    const iso = "2026-07-22T10:15:30.000Z"
    // No published locale: the browser's own, spelled out (an argument-less or
    // `undefined` toLocaleString is what the kit's number gate bans).
    const browserLocale = new Intl.DateTimeFormat().resolvedOptions().locale
    expect(formatTimestamp(iso)).toBe(new Date(iso).toLocaleString(browserLocale))
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString())
    expect(formatTime(iso)).toBe(new Date(iso).toLocaleTimeString())
  })

  it("returns the placeholder for null/undefined/empty input", () => {
    for (const value of [null, undefined, ""]) {
      expect(formatTimestamp(value)).toBe(EMPTY)
      expect(formatDate(value)).toBe(EMPTY)
      expect(formatTime(value)).toBe(EMPTY)
    }
  })

  it("returns the placeholder for an unparsable date instead of 'Invalid Date'", () => {
    expect(formatTimestamp("not-a-date")).toBe(EMPTY)
    expect(formatDate("not-a-date")).toBe(EMPTY)
    expect(formatTime("not-a-date")).toBe(EMPTY)
  })
})

describe("formatDuration", () => {
  it("formats the canonical compact family", () => {
    expect(formatDuration(420)).toBe("420ms")
    expect(formatDuration(12_000)).toBe("12s")
    expect(formatDuration(187_000)).toBe("3m 7s")
    expect(formatDuration(5_040_000)).toBe("1h 24m")
  })

  it("rounds fractional milliseconds", () => {
    expect(formatDuration(420.4)).toBe("420ms")
    expect(formatDuration(999.6)).toBe("1s")
  })

  it("returns the placeholder for null, negative and NaN input", () => {
    expect(formatDuration(null)).toBe(EMPTY)
    expect(formatDuration(undefined)).toBe(EMPTY)
    expect(formatDuration(-1)).toBe(EMPTY)
    expect(formatDuration(Number.NaN)).toBe(EMPTY)
  })

  it("speaks German units in a German view: a space before the unit, never wrapping", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatDuration(420)).toBe(`420${NBSP}ms`)
    expect(formatDuration(12_000)).toBe(`12${NBSP}s`)
    expect(formatDuration(187_000)).toBe(`3${NBSP}Min. 7${NBSP}s`)
    expect(formatDuration(5_040_000)).toBe(`1${NBSP}h 24${NBSP}Min.`)
    expect(formatDuration(3_600_000 * 1234)).toBe(`1.234${NBSP}h 0${NBSP}Min.`)
  })

  it("keeps the compact English family in an English view, grouped by the locale", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatDuration(187_000)).toBe("3m 7s")
    expect(formatDuration(3_600_000 * 1234)).toBe("1,234h 0m")
  })
})

const NBSP = " "

describe("formatNumber", () => {
  it("groups and separates decimals in the view's locale", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatNumber(1234567.5)).toBe("1.234.567,5")
    expect(formatNumber(0.25, { style: "percent" })).toBe(`25${NBSP}%`)
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatNumber(1234567.5)).toBe("1,234,567.5")
    expect(formatNumber(1234.567, { maximumFractionDigits: 1 })).toBe("1,234.6")
  })

  it("returns the placeholder for missing and non-finite values, 0 stays 0", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatNumber(value)).toBe(EMPTY)
    }
    expect(formatNumber(0)).toBe("0")
  })
})

describe("formatPercent / formatPercentPoints", () => {
  it("formats percent units: 3,7 % in German, 3.7% in English", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatPercent(3.7)).toBe(`3,7${NBSP}%`)
    expect(formatPercent(3)).toBe(`3${NBSP}%`)
    expect(formatPercent(3, { minimumFractionDigits: 1 })).toBe(`3,0${NBSP}%`)
    expect(formatPercent(-84.66, { signed: true })).toBe(`-84,7${NBSP}%`)
    expect(formatPercent(12.345, { maximumFractionDigits: 2 })).toBe(`12,35${NBSP}%`)
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatPercent(3.7)).toBe("3.7%")
    expect(formatPercent(427.4, { signed: true })).toBe("+427.4%")
    expect(formatPercent(0, { signed: true })).toBe("0%")
  })

  it("formats percentage points signed by default: +0,2 Pp. / +0.2 pp", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatPercentPoints(0.2)).toBe(`+0,2${NBSP}Pp.`)
    expect(formatPercentPoints(-1.25)).toBe(`-1,3${NBSP}Pp.`)
    expect(formatPercentPoints(0)).toBe(`0${NBSP}Pp.`)
    setFormatLocale({ language: "en", locale: "en-GB" })
    expect(formatPercentPoints(0.2)).toBe(`+0.2${NBSP}pp`)
    expect(formatPercentPoints(0.2, { signed: false })).toBe(`0.2${NBSP}pp`)
  })

  it("raises the default maximum to a larger minimum instead of throwing during render", () => {
    // `rate.toFixed(2) + "%"` migrated naturally: the default maximum of 1
    // would sit below the minimum, which Intl rejects with a RangeError.
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatPercent(3.75, { minimumFractionDigits: 2 })).toBe(`3,75${NBSP}%`)
    expect(formatPercentPoints(0.25, { minimumFractionDigits: 2 })).toBe(`+0,25${NBSP}Pp.`)
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatPercent(3.7, { minimumFractionDigits: 3 })).toBe("3.700%")
    expect(formatPercent(3.75, { minimumFractionDigits: 2, maximumFractionDigits: 1 })).toBe(
      "3.75%",
    )
  })

  it("returns the placeholder for a missing value", () => {
    expect(formatPercent(null)).toBe(EMPTY)
    expect(formatPercentPoints(undefined)).toBe(EMPTY)
    expect(formatPercent(Number.NaN)).toBe(EMPTY)
  })
})

describe("formatPeriod", () => {
  it("spells a period token in the view's language, singular and plural", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatPeriod("7d")).toBe(`7${NBSP}Tage`)
    expect(formatPeriod("1d")).toBe(`1${NBSP}Tag`)
    expect(formatPeriod("24h")).toBe(`24${NBSP}Stunden`)
    expect(formatPeriod("1H")).toBe(`1${NBSP}Stunde`)
    expect(formatPeriod("30m")).toBe(`30${NBSP}Minuten`)
    expect(formatPeriod("2w")).toBe(`2${NBSP}Wochen`)
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatPeriod("7d")).toBe(`7${NBSP}days`)
    expect(formatPeriod("1w")).toBe(`1${NBSP}week`)
    expect(formatPeriod(" 14d ")).toBe(`14${NBSP}days`)
  })

  it("passes anything else through and renders the placeholder for no period", () => {
    expect(formatPeriod("last quarter")).toBe("last quarter")
    expect(formatPeriod("7y")).toBe("7y")
    expect(formatPeriod("")).toBe(EMPTY)
    expect(formatPeriod(null)).toBe(EMPTY)
  })

  it("speaks English while no locale is published (fixtures, unit renders)", () => {
    expect(formatPeriod("3d")).toBe(`3${NBSP}days`)
    expect(formatPercentPoints(1)).toContain("pp")
  })
})

describe("truncate", () => {
  it("truncates with an ellipsis and passes short values through", () => {
    expect(truncate("abcdef", 3)).toBe("abc…")
    expect(truncate("abc", 3)).toBe("abc")
    expect(truncate(null, 3)).toBe(EMPTY)
  })
})
