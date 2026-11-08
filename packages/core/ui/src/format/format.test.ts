import { afterEach, describe, expect, it, vi } from "vitest"
import {
  formatClock,
  formatCompactCount,
  formatCount,
  formatDate,
  formatDuration,
  formatInstant,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  formatRelativeTime,
  formatTime,
  formatTimestamp,
  getFormatLocale,
  setFormatLocale,
  shortId,
  subscribeFormatLocale,
  truncate,
} from "./index.js"

const EMPTY = "—"

afterEach(() => setFormatLocale(undefined))

describe("the published format locale (set by the shell's LocaleGate)", () => {
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
    expect(formatDuration(86_399_999)).toBe("23h 59m")
    expect(formatDuration(97_200_000)).toBe("1d 3h")
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
    expect(formatDuration(3_600_000 * 27)).toBe(`1${NBSP}d 3${NBSP}h`)
    expect(formatDuration(86_400_000 * 1234)).toBe(`1.234${NBSP}d 0${NBSP}h`)
  })

  it("keeps the compact English family in an English view, grouped by the locale", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatDuration(187_000)).toBe("3m 7s")
    expect(formatDuration(86_400_000 * 1234)).toBe("1,234d 0h")
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

/** The VS Code extension's locale: English words, a 24-hour clock. */
const ENGLISH_24H = { language: "en", locale: "en-u-hc-h23", timeZone: "Europe/Berlin" }

describe("formatTime to the millisecond", () => {
  it("adds the milliseconds in the view's locale, so close runs stay apart", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatTime("2026-10-21T07:05:07.042Z", { milliseconds: true })).toBe("09:05:07.042")
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin" })
    expect(formatTime("2026-10-21T07:05:07.042Z", { milliseconds: true })).toBe("09:05:07,042")
  })

  it("follows the locale's clock: a 12-hour English, a 24-hour one with -u-hc-h23", () => {
    setFormatLocale({ language: "en", locale: "en-US", timeZone: "UTC" })
    expect(formatTime("2026-10-21T16:41:00Z", { seconds: false })).toBe("04:41 PM")
    setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
    expect(formatTime("2026-10-21T16:41:00Z", { seconds: false })).toBe("16:41")
    expect(formatTime("2026-10-21T06:41:09Z")).toBe("06:41:09")
  })
})

describe("formatClock", () => {
  const iso = "2026-10-21T07:05:07.042Z"
  const sameDay = new Date("2026-10-21T20:00:00Z")
  const nextDay = new Date("2026-10-22T07:00:00Z")

  it("shows the time alone on its own day, at the asked precision", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatClock(iso, { seconds: false, now: sameDay })).toBe("09:05")
    expect(formatClock(iso, { now: sameDay })).toBe("09:05:07")
    expect(formatClock(iso, { milliseconds: true, now: sameDay })).toBe("09:05:07.042")
  })

  it("puts the day before the time on any other day", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatClock(iso, { seconds: false, now: nextDay })).toBe("Oct 21, 09:05")
    expect(formatClock(iso, { now: nextDay })).toBe("Oct 21, 09:05:07")
    expect(formatClock(iso, { milliseconds: true, now: nextDay })).toBe("Oct 21, 09:05:07.042")
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin" })
    expect(formatClock(iso, { seconds: false, now: nextDay })).toBe("21. Okt., 09:05")
  })

  it("counts the day in the view's time zone", () => {
    // 23:30 UTC on the 21st is already the 22nd in Berlin.
    setFormatLocale(ENGLISH_24H)
    expect(formatClock("2026-10-21T23:30:00Z", { seconds: false, now: nextDay })).toBe("01:30")
  })

  it("returns the placeholder for no or an unparsable time", () => {
    for (const value of [null, undefined, "", "not a time"]) {
      expect(formatClock(value)).toBe(EMPTY)
      expect(formatInstant(value)).toBe(EMPTY)
      expect(formatRelativeTime(value)).toBe(EMPTY)
    }
  })
})

describe("formatInstant", () => {
  it("names the instant in the view's zone and in UTC", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatInstant("2026-10-21T12:02:00Z")).toBe(
      "Oct 21, 2026, 14:02:00 GMT+2 · Oct 21, 2026, 12:02:00 UTC",
    )
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-21T12:00:00Z")
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString()

  it("speaks the largest whole unit from minutes to days", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatRelativeTime(at(-5 * 60_000), now)).toBe("5m ago")
    expect(formatRelativeTime(at(2 * 3_600_000), now)).toBe("in 2h")
    expect(formatRelativeTime(at(-3 * 86_400_000), now)).toBe("3d ago")
  })

  it("says under a minute in words, past and future", () => {
    setFormatLocale(ENGLISH_24H)
    expect(formatRelativeTime(at(-20_000), now)).toBe("just now")
    expect(formatRelativeTime(at(20_000), now)).toBe("in under a minute")
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatRelativeTime(at(-20_000), now)).toBe("gerade eben")
    expect(formatRelativeTime(at(20_000), now)).toBe("in unter einer Minute")
    expect(formatRelativeTime(at(-5 * 60_000), now)).toBe("vor 5 Min.")
  })
})

describe("formatCount / formatCompactCount", () => {
  it("renders an exact count, a lower bound and an unknown one", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatCount(1234)).toBe("1,234")
    expect(formatCount(0)).toBe("0")
    expect(formatCount({ atLeast: 2000 })).toBe(`≥${NBSP}2,000`)
    for (const value of [null, undefined, Number.NaN]) expect(formatCount(value)).toBe(EMPTY)
    setFormatLocale({ language: "de", locale: "de-DE" })
    expect(formatCount({ atLeast: 2000 })).toBe(`≥${NBSP}2.000`)
  })

  it("shortens from 1,000 on, in the locale, with a + for a lower bound", () => {
    setFormatLocale({ language: "en", locale: "en-US" })
    expect(formatCompactCount(999)).toBe("999")
    expect(formatCompactCount(1234)).toBe("1.2k")
    // M and B stay capital: a small m is the minutes of a duration ("3m 7s").
    expect(formatCompactCount(1_500_000)).toBe("1.5M")
    expect(formatCompactCount(2_000_000_000)).toBe("2B")
    expect(formatCompactCount({ atLeast: 10_000 })).toBe("10k+")
    expect(formatCompactCount({ atLeast: 40 })).toBe("40+")
    expect(formatCompactCount(null)).toBe(EMPTY)
    setFormatLocale({ language: "de", locale: "de-DE" })
    // German shortens from a million; below it a count is grouped as formatCount writes it.
    expect(formatCompactCount(1234)).toBe("1.234")
    expect(formatCompactCount(12_345)).toBe("12.345")
    expect(formatCompactCount({ atLeast: 10_000 })).toBe("10.000+")
    expect(formatCompactCount(1_500_000)).toBe(`1,5${NBSP}Mio.`)
  })
})

describe("shortId", () => {
  const UUID = "5f0ce78e-1c47-11f0-9a3b-0242ac120002"

  it("keeps an id of up to 12 characters whole", () => {
    expect(shortId("LEA-2026-04")).toBe("LEA-2026-04")
    expect(shortId("123456789012")).toBe("123456789012")
  })

  it("shows a longer number by its tail and a UUID by its head", () => {
    expect(shortId("2251799813685249")).toBe("…13685249")
    expect(shortId("1234567890123")).toBe("…67890123")
    expect(shortId(UUID)).toBe("5f0ce78e…")
    expect(shortId(UUID.toUpperCase())).toBe("5F0CE78E…")
  })

  it("keeps any other id whole: no part of it is safe to drop", () => {
    expect(shortId("invoice:3:a1b2c3")).toBe("invoice:3:a1b2c3")
    expect(shortId("fake-ORD-1002")).toBe("fake-ORD-1002")
  })
})
