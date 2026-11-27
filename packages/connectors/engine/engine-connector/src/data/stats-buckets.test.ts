import { describe, expect, it } from "vitest"
import {
  bucketsOf,
  canonicalTimeZone,
  dayStartOf,
  DEFAULT_BUCKETS,
  FORMATTERS_KEPT,
  isTimeZone,
  keptFormatters,
  MAX_BUCKETS,
  wholeMinutes,
} from "./stats-buckets.js"

const at = (iso: string) => Date.parse(iso)
const spans = (range: ReturnType<typeof bucketsOf>) =>
  range.buckets.map(({ start, end }) => [
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  ])
const hours = (range: ReturnType<typeof bucketsOf>) =>
  range.buckets.map(({ start, end }) => (end - start) / 3_600_000)

describe("bucketsOf", () => {
  it("cuts the last 14 UTC days by default, today up to now", () => {
    const now = at("2026-11-24T10:30:00.000Z")
    const range = bucketsOf({ bucket: "day", timeZone: "UTC" }, now)
    expect(range.buckets).toHaveLength(DEFAULT_BUCKETS.day)
    expect(new Date(range.from).toISOString()).toBe("2026-11-11T00:00:00.000Z")
    expect(range.to).toBe(now)
    expect(spans(range).at(-1)).toEqual(["2026-11-24T00:00:00.000Z", "2026-11-24T10:30:00.000Z"])
    expect(spans(range)[0]).toEqual(["2026-11-11T00:00:00.000Z", "2026-11-12T00:00:00.000Z"])
  })

  it("follows the zone's calendar days, 25 hours long where the clocks go back", () => {
    const now = at("2026-10-27T12:00:00.000Z")
    const range = bucketsOf({ bucket: "day", timeZone: "Europe/Berlin" }, now)
    // Local midnight is 22:00 UTC in summer time and 23:00 UTC after 25 October.
    expect(new Date(range.from).toISOString()).toBe("2026-10-13T22:00:00.000Z")
    expect(hours(range)).toContain(25)
    const back = range.buckets.find(({ start, end }) => end - start === 25 * 3_600_000)
    expect(new Date(back!.start).toISOString()).toBe("2026-10-24T22:00:00.000Z")
    expect(new Date(back!.end).toISOString()).toBe("2026-10-25T23:00:00.000Z")
  })

  it("starts the first bucket at from and ends each at the next local day", () => {
    const range = bucketsOf(
      {
        from: at("2026-03-28T23:00:00.000Z"),
        to: at("2026-03-31T22:00:00.000Z"),
        bucket: "day",
        timeZone: "Europe/Berlin",
      },
      at("2026-04-02T00:00:00.000Z"),
    )
    expect(spans(range)).toEqual([
      ["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
      ["2026-03-29T22:00:00.000Z", "2026-03-30T22:00:00.000Z"],
      ["2026-03-30T22:00:00.000Z", "2026-03-31T22:00:00.000Z"],
    ])
    expect(hours(range)).toEqual([23, 24, 24])
  })

  it("cuts hours at the zone's hour starts, also on a half-hour offset", () => {
    const now = at("2026-11-24T10:50:00.000Z")
    const utc = bucketsOf({ bucket: "hour", timeZone: "UTC" }, now)
    expect(utc.buckets).toHaveLength(DEFAULT_BUCKETS.hour)
    expect(new Date(utc.from).toISOString()).toBe("2026-11-23T11:00:00.000Z")
    // India is 5:30 ahead: its hours start at half past in UTC.
    const india = bucketsOf({ bucket: "hour", timeZone: "Asia/Kolkata" }, now)
    expect(new Date(india.from).toISOString()).toBe("2026-11-23T11:30:00.000Z")
    expect(spans(india).at(-1)).toEqual(["2026-11-24T10:30:00.000Z", "2026-11-24T10:50:00.000Z"])
  })

  it("makes the hour the clocks go back two hours long", () => {
    const range = bucketsOf(
      {
        from: at("2026-10-24T23:00:00.000Z"),
        to: at("2026-10-25T02:00:00.000Z"),
        bucket: "hour",
        timeZone: "Europe/Berlin",
      },
      at("2026-10-26T00:00:00.000Z"),
    )
    // 01:00 in summer time, then 02:00 twice (summer, then winter time), up to 03:00.
    expect(hours(range)).toEqual([1, 2])
  })

  it("ends at now when to lies later, and a whole day at a midnight to", () => {
    const now = at("2026-11-24T10:30:00.000Z")
    const later = bucketsOf(
      { to: at("2026-12-01T00:00:00.000Z"), bucket: "day", timeZone: "UTC" },
      now,
    )
    expect(later.to).toBe(now)
    const midnight = bucketsOf(
      { to: at("2026-11-24T00:00:00.000Z"), bucket: "day", timeZone: "UTC" },
      now,
    )
    expect(spans(midnight).at(-1)).toEqual(["2026-11-23T00:00:00.000Z", "2026-11-24T00:00:00.000Z"])
    expect(midnight.buckets).toHaveLength(DEFAULT_BUCKETS.day)
  })

  it("refuses a range that ends before it starts, or one of too many buckets", () => {
    const now = at("2026-11-24T10:30:00.000Z")
    expect(() =>
      bucketsOf({ from: at("2026-11-25T00:00:00.000Z"), bucket: "day", timeZone: "UTC" }, now),
    ).toThrow(/from .* must lie before to/)
    expect(() =>
      bucketsOf({ from: at("2026-11-01T00:00:00.000Z"), bucket: "hour", timeZone: "UTC" }, now),
    ).toThrow(`more than ${MAX_BUCKETS} hour buckets: narrow from and to, or take bucket "day".`)
    expect(() =>
      bucketsOf({ from: at("2026-01-01T00:00:00.000Z"), bucket: "day", timeZone: "UTC" }, now),
    ).toThrow(`more than ${MAX_BUCKETS} day buckets: narrow from and to.`)
    // Exactly the most buckets one call reads.
    const most = bucketsOf(
      {
        from: at("2026-11-22T10:00:00.000Z"),
        to: at("2026-11-24T10:00:00.000Z"),
        bucket: "hour",
        timeZone: "UTC",
      },
      now,
    )
    expect(most.buckets).toHaveLength(MAX_BUCKETS)
  })
})

describe("wholeMinutes", () => {
  const now = at("2026-11-24T10:30:15.000Z")
  const day = { bucket: "day", timeZone: "Europe/Berlin" } as const

  it("cuts an explicit from down and an explicit to up to a whole minute", () => {
    const asked = {
      ...day,
      from: at("2026-11-20T08:15:30.001Z"),
      to: at("2026-11-23T09:00:00.001Z"),
    }
    expect(wholeMinutes(asked, now)).toEqual({
      ...day,
      from: at("2026-11-20T08:15:00.000Z"),
      to: at("2026-11-23T09:01:00.000Z"),
    })
    // Whole minutes stay as they are, and what is left out stays out.
    const whole = { ...day, from: at("2026-11-20T08:15:00.000Z"), to: at("2026-11-23T09:01:00Z") }
    expect(wholeMinutes(whole, now)).toEqual(whole)
    expect(wholeMinutes(day, now)).toEqual(day)
  })

  it("reads a to the cut brings to now or later up to now, as one left out", () => {
    expect(wholeMinutes({ ...day, to: at("2026-11-24T10:30:05.000Z") }, now)).toEqual(day)
    expect(wholeMinutes({ ...day, to: at("2026-12-01T00:00:00.000Z") }, now)).toEqual(day)
  })

  it("refuses a from that does not lie before its to before the cut could join them", () => {
    const within = { ...day, from: at("2026-11-20T08:15:40Z"), to: at("2026-11-20T08:15:20Z") }
    expect(() => wholeMinutes(within, now)).toThrow(/from .* must lie before to/)
    expect(() => wholeMinutes({ ...day, from: at("2026-11-24T10:30:20Z") }, now)).toThrow(
      /from .* must lie before to/,
    )
  })
})

describe("isTimeZone", () => {
  it("knows IANA zones and refuses anything else", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true)
    expect(isTimeZone("UTC")).toBe(true)
    expect(isTimeZone("Mars/Olympus")).toBe(false)
  })
})

describe("the zones a caller names", () => {
  /** Every spelling Intl takes of one zone: its letters in each case. */
  const spellings = (zone: string, count: number) =>
    Array.from({ length: count }, (_, n) =>
      [...zone]
        .map((ch, i) => ((n >> (i % 12)) & 1 ? ch.toUpperCase() : ch.toLowerCase()))
        .join(""),
    )

  it("are named as the runtime spells them", () => {
    expect(canonicalTimeZone("eUrOpE/bErLiN")).toBe("Europe/Berlin")
    expect(canonicalTimeZone("UTC")).toBe("UTC")
    expect(canonicalTimeZone("Mars/Olympus")).toBeNull()
  })

  it("keep nothing when only checked, and a bounded few when read", () => {
    dayStartOf(2026, 11, 20, "UTC")
    const before = keptFormatters()
    for (const zone of spellings("America/Argentina/Buenos_Aires", 200)) {
      expect(isTimeZone(zone)).toBe(true)
    }
    expect(keptFormatters()).toBe(before)
    for (const zone of spellings("America/Argentina/Buenos_Aires", 50)) {
      dayStartOf(2026, 11, 20, zone)
    }
    // Every spelling is one zone: kept once.
    expect(keptFormatters()).toBeLessThanOrEqual(before + 1)
    for (let minutes = 0; minutes < 2 * FORMATTERS_KEPT; minutes++) {
      const offset = `+${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
      dayStartOf(2026, 11, 20, offset)
    }
    expect(keptFormatters()).toBe(FORMATTERS_KEPT)
  })
})

describe("dayStartOf", () => {
  it("is the day's local midnight in the zone, east and west of UTC alike", () => {
    const iso = (n: number) => new Date(n).toISOString()
    expect(iso(dayStartOf(2026, 11, 20, "UTC"))).toBe("2026-11-20T00:00:00.000Z")
    expect(iso(dayStartOf(2026, 11, 20, "Europe/Berlin"))).toBe("2026-11-19T23:00:00.000Z")
    expect(iso(dayStartOf(2026, 7, 20, "Europe/Berlin"))).toBe("2026-07-19T22:00:00.000Z")
    expect(iso(dayStartOf(2026, 11, 20, "Pacific/Kiritimati"))).toBe("2026-11-19T10:00:00.000Z")
    expect(iso(dayStartOf(2026, 11, 20, "Pacific/Pago_Pago"))).toBe("2026-11-20T11:00:00.000Z")
  })
})
