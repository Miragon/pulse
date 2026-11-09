import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  ENGINE_DATE_INPUT_FORMS,
  earliestEngineDate,
  engineDateInput,
  engineDateMillis,
  isEngineDateInput,
  OFFSET_REQUIRED,
  latestEngineDate,
  toEngineDate,
  toOptionalEngineDate,
  type DateInputReading,
  UTC_WITHOUT_OFFSET,
} from "./dates.js"

/** Every reading of the one parser. */
const READINGS: readonly DateInputReading[] = [OFFSET_REQUIRED, UTC_WITHOUT_OFFSET]

/** The ONLY shape CIB seven parses (verified live: every other form is a 400). */
const ENGINE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/

describe("toEngineDate", () => {
  it.each([
    ["2026-10-01", "2026-10-01T00:00:00.000+0000"],
    ["2026-10-01T00:00:00Z", "2026-10-01T00:00:00.000+0000"],
    ["2026-10-01t08:30:00z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30Z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00.000Z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00.5Z", "2026-10-01T08:30:00.500+0000"],
    ["2026-10-01T08:30:00,25Z", "2026-10-01T08:30:00.250+0000"],
    ["2026-10-01T08:30:00.123456789Z", "2026-10-01T08:30:00.123+0000"],
    ["2026-10-01T08:30:00+02:00", "2026-10-01T08:30:00.000+0200"],
    ["2026-10-01T08:30:00-05:30", "2026-10-01T08:30:00.000-0530"],
    ["2026-10-01T08:30:00+02", "2026-10-01T08:30:00.000+0200"],
    ["2026-10-01 08:30:00+0200", "2026-10-01T08:30:00.000+0200"],
    // The engine's own output round-trips unchanged.
    ["2026-09-30T22:00:00.000+0000", "2026-09-30T22:00:00.000+0000"],
    ["  2026-10-01  ", "2026-10-01T00:00:00.000+0000"],
  ])("%s → %s", (input, expected) => {
    expect(toEngineDate(input)).toBe(expected)
    expect(toEngineDate(input)).toMatch(ENGINE_FORMAT)
  })

  it("keeps the instant: the converted value parses to the same epoch", () => {
    for (const input of ["2026-10-01T08:30:00+02:00", "2026-03-29T01:59:59.999-11:45"]) {
      const engine = toEngineDate(input)
      const asIso = engine.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
      expect(Date.parse(asIso)).toBe(Date.parse(input))
    }
  })

  it("writes a Date in UTC with milliseconds", () => {
    expect(toEngineDate(new Date(Date.UTC(2026, 9, 1, 8, 30, 0, 7)))).toBe(
      "2026-10-01T08:30:00.007+0000",
    )
  })

  it("refuses an invalid Date", () => {
    expect(() => toEngineDate(new Date(Number.NaN))).toThrow(RangeError)
  })

  it.each([
    "",
    "yesterday",
    "2026-10-01T08:30:00", // a local time would mean the ENGINE's time zone
    "2026-10-01T08:30",
    "2026-13-01",
    "2026-02-30",
    "2026-02-29", // 2026 is no leap year
    "2026-10-01T24:00:00Z",
    "2026-10-01T23:60:00Z",
    "2026-10-01T23:59:60Z",
    "2026-10-01T08:30:00+24:00",
    "2026-10-01T08:30:00+02:60",
    "2026-10-01T08:30:00+020",
    "26-10-01",
    "2026-1-01",
  ])("refuses %j, naming the accepted forms", (input) => {
    expect(isEngineDateInput(input)).toBe(false)
    expect(() => toEngineDate(input)).toThrow(
      `Invalid date "${input}": expected ${ENGINE_DATE_INPUT_FORMS}`,
    )
  })

  it("accepts a leap day in a leap year", () => {
    expect(isEngineDateInput("2028-02-29")).toBe(true)
    expect(toEngineDate("2028-02-29")).toBe("2028-02-29T00:00:00.000+0000")
  })

  it("names every accepted form in the shared hint", () => {
    expect(ENGINE_DATE_INPUT_FORMS).toContain("2026-10-01")
    expect(ENGINE_DATE_INPUT_FORMS).toContain("2026-10-01T08:30:00Z")
    expect(ENGINE_DATE_INPUT_FORMS).toContain("+02:00")
  })
})

describe("toOptionalEngineDate", () => {
  it("leaves an absent filter absent and converts a present one", () => {
    expect(toOptionalEngineDate(undefined)).toBeUndefined()
    expect(toOptionalEngineDate("2026-10-01")).toBe("2026-10-01T00:00:00.000+0000")
  })
})

describe("engineDateMillis: engine timestamps order by instant (#335 N71)", () => {
  it.each([
    ["2026-10-25T02:30:00.000+0200", Date.UTC(2026, 9, 25, 0, 30)],
    ["2026-10-25T02:10:00.000+0100", Date.UTC(2026, 9, 25, 1, 10)],
    ["2026-10-01T08:30:00.250-0530", Date.UTC(2026, 9, 1, 14, 0, 0, 250)],
    ["2026-10-01T08:30:00.000+0000", Date.UTC(2026, 9, 1, 8, 30)],
    ["2026-10-01T08:30:00Z", Date.UTC(2026, 9, 1, 8, 30)],
    ["2026-10-01T08:30:00+02:00", Date.UTC(2026, 9, 1, 6, 30)],
    ["2026-10-01", Date.UTC(2026, 9, 1)],
  ])("%s → its instant", (value, millis) => {
    expect(engineDateMillis(value)).toBe(millis)
  })

  it.each([null, undefined, "", "yesterday", "2026-02-30T00:00:00.000+0000", "2026-10-01T08:30"])(
    "%j → null, never a guessed instant",
    (value) => {
      expect(engineDateMillis(value)).toBeNull()
    },
  )
})

describe("latestEngineDate / earliestEngineDate", () => {
  // The DST fall-back hour: textually "02:30+0200" > "02:10+0100", but the
  // +0100 stamp is 40 minutes LATER.
  const beforeFallBack = "2026-10-25T02:30:00.000+0200"
  const afterFallBack = "2026-10-25T02:10:00.000+0100"

  it("picks by instant, not by string, and returns the value as given", () => {
    expect(latestEngineDate([beforeFallBack, afterFallBack])).toBe(afterFallBack)
    expect(latestEngineDate([afterFallBack, beforeFallBack])).toBe(afterFallBack)
    expect(earliestEngineDate([afterFallBack, beforeFallBack])).toBe(beforeFallBack)
    expect(earliestEngineDate([beforeFallBack, afterFallBack])).toBe(beforeFallBack)
  })

  it("keeps the first of equal instants", () => {
    const zulu = "2026-10-01T08:30:00.000Z"
    const engine = "2026-10-01T10:30:00.000+0200"
    expect(latestEngineDate([zulu, engine])).toBe(zulu)
    expect(earliestEngineDate([engine, zulu])).toBe(engine)
  })

  it("skips unparseable values and answers null when nothing parses", () => {
    expect(latestEngineDate([null, "nope", beforeFallBack, undefined])).toBe(beforeFallBack)
    expect(earliestEngineDate(["nope", afterFallBack])).toBe(afterFallBack)
    expect(latestEngineDate([])).toBeNull()
    expect(earliestEngineDate([null, ""])).toBeNull()
  })
})

/**
 * The two readings of one parser. They differ today and each interface keeps its own until one
 * reading is chosen for all (a behaviour change): these cases pin every difference.
 */
describe("engineDateInput: the two readings", () => {
  it("reads as OFFSET_REQUIRED by default", () => {
    expect(engineDateInput("2026-10-01T08:30:00Z")).toBe("2026-10-01T08:30:00.000+0000")
    expect(engineDateInput("2026-10-01T08:30:00")).toBeUndefined()
    expect(isEngineDateInput("2026-10-01T08:30:00")).toBe(false)
  })

  it.each([
    ["2026-10-01T08:30", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00.5", "2026-10-01T08:30:00.500+0000"],
  ])("UTC_WITHOUT_OFFSET reads the time without an offset %s as UTC", (input, expected) => {
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBe(expected)
    expect(isEngineDateInput(input, UTC_WITHOUT_OFFSET)).toBe(true)
    expect(engineDateInput(input, OFFSET_REQUIRED)).toBeUndefined()
  })

  it.each([
    ["2026-10-01", "2026-10-01T00:00:00.000+0000"],
    ["2026-10-01T08:30:00Z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00.123+02:00", "2026-10-01T08:30:00.123+0200"],
    ["2026-10-01T08:30:00-0530", "2026-10-01T08:30:00.000-0530"],
    ["2026-02-28T23:59:59.999+0000", "2026-02-28T23:59:59.999+0000"],
  ])("both readings convert %s alike", (input, expected) => {
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBe(expected)
    expect(engineDateInput(input, OFFSET_REQUIRED)).toBe(expected)
  })

  it.each([
    ["  2026-10-01  ", "2026-10-01T00:00:00.000+0000"],
    ["2026-10-01t08:30:00Z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01 08:30:00Z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00,25Z", "2026-10-01T08:30:00.250+0000"],
    ["2026-10-01T08:30:00z", "2026-10-01T08:30:00.000+0000"],
    ["2026-10-01T08:30:00+02", "2026-10-01T08:30:00.000+0200"],
  ])("only the relaxed reading accepts the spelling %j", (input, expected) => {
    expect(engineDateInput(input, OFFSET_REQUIRED)).toBe(expected)
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBeUndefined()
  })

  it("cuts any number of fraction digits strictly, at most 9 relaxed", () => {
    expect(engineDateInput("2026-10-01T08:30:00.1234567891Z", UTC_WITHOUT_OFFSET)).toBe(
      "2026-10-01T08:30:00.123+0000",
    )
    expect(engineDateInput("2026-10-01T08:30:00.1234567891Z", OFFSET_REQUIRED)).toBeUndefined()
    expect(engineDateInput("2026-10-01T08:30:00.123456789Z", OFFSET_REQUIRED)).toBe(
      "2026-10-01T08:30:00.123+0000",
    )
  })

  it("checks the Gregorian calendar strictly and Date.UTC's relaxed (years 0000-0099 as 19xx)", () => {
    expect(engineDateInput("0000-02-29", UTC_WITHOUT_OFFSET)).toBe("0000-02-29T00:00:00.000+0000")
    expect(engineDateInput("0000-02-29", OFFSET_REQUIRED)).toBeUndefined()
    for (const reading of READINGS) {
      expect(engineDateInput("0096-02-29", reading)).toBe("0096-02-29T00:00:00.000+0000")
      expect(engineDateInput("2024-02-29", reading)).toBe("2024-02-29T00:00:00.000+0000")
      expect(engineDateInput("1900-02-29", reading)).toBeUndefined()
      expect(engineDateInput("2026-04-31", reading)).toBeUndefined()
      expect(engineDateInput("2026-00-10", reading)).toBeUndefined()
      expect(engineDateInput("2026-13-10", reading)).toBeUndefined()
      expect(engineDateInput("2026-01-00", reading)).toBeUndefined()
    }
  })

  it.each([
    "2026-10-01T24:00:00Z",
    "2026-10-01T08:60:00Z",
    "2026-10-01T08:30:60Z",
    "2026-10-01T08:30:00+2400",
    "2026-10-01T08:30:00+02:60",
    "2026-10-01T08:30:00.Z",
    "2026-10-01T",
    "26-10-01",
  ])("both readings refuse %j", (input) => {
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBeUndefined()
    expect(engineDateInput(input, OFFSET_REQUIRED)).toBeUndefined()
  })
})

/** Instant of an engine formatted value (`+0200` → `+02:00` so Date.parse reads it). */
function instantOf(engine: string): number {
  return Date.parse(engine.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0")
}

/** Days of a month in the proleptic Gregorian calendar. */
function daysIn(year: number, month: number): number {
  const date = new Date(0)
  // setUTCFullYear does not map years 0-99 to 1900-1999 like Date.UTC
  date.setUTCFullYear(year, month, 0)
  return date.getUTCDate()
}

const offsetArb = fc.record({
  sign: fc.constantFrom("+", "-"),
  hours: fc.integer({ min: 0, max: 23 }),
  minutes: fc.integer({ min: 0, max: 59 }),
  style: fc.constantFrom("colon", "compact", "z"),
})

/** ISO 8601 with an offset (minutes, seconds or up to 9 fraction digits), years 0001-9999. */
const isoArb = fc
  .record({
    date: fc.date({
      min: new Date("0001-01-01T00:00:00Z"),
      max: new Date("9999-12-30T00:00:00Z"),
      noInvalidDate: true,
    }),
    precision: fc.constantFrom("minutes", "seconds", "fraction"),
    fraction: fc.stringMatching(/^\d{1,9}$/),
    offset: offsetArb,
  })
  .map(({ date, precision, fraction, offset }) => {
    const iso = date.toISOString()
    const base =
      precision === "minutes"
        ? iso.slice(0, 16)
        : precision === "seconds"
          ? iso.slice(0, 19)
          : `${iso.slice(0, 19)}.${fraction}`
    const zone =
      offset.style === "z"
        ? "Z"
        : `${offset.sign}${pad(offset.hours)}${offset.style === "colon" ? ":" : ""}${pad(offset.minutes)}`
    return `${base}${zone}`
  })

/** The first year whose calendar the reading checks like the Gregorian one (Date.UTC: 0 is 1900). */
const GREGORIAN_FROM: Readonly<Record<DateInputReading, number>> = {
  [UTC_WITHOUT_OFFSET]: 0,
  [OFFSET_REQUIRED]: 1,
}

describe.each(READINGS)("engineDateInput: %s properties", (reading) => {
  const convert = (input: string): string => {
    const engine = engineDateInput(input, reading)
    if (engine === undefined) throw new Error(`refused ${input}`)
    return engine
  }

  it("always produces the engine format", () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        expect(convert(raw)).toMatch(ENGINE_FORMAT)
      }),
    )
  })

  it("is idempotent", () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        const once = convert(raw)
        expect(convert(once)).toBe(once)
      }),
    )
  })

  it("keeps the instant of ISO input with an offset", () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        expect(instantOf(convert(raw))).toBe(Date.parse(raw))
      }),
    )
  })

  it("refuses invalid calendar dates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 9 }),
        (year, month, beyond) => {
          const day = daysIn(year, month) + beyond
          if (day > 99) return
          expect(
            engineDateInput(`${pad(year, 4)}-${pad(month)}-${pad(day)}`, reading),
          ).toBeUndefined()
        },
      ),
    )
  })

  it("accepts every valid calendar date of its calendar", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: GREGORIAN_FROM[reading], max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, rawDay) => {
          const day = Math.min(rawDay, daysIn(year, month))
          const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
          expect(convert(date)).toBe(`${date}T00:00:00.000+0000`)
        },
      ),
    )
  })
})

describe("engineDateInput: UTC_WITHOUT_OFFSET (the CLI's reading)", () => {
  it.each([
    ["2024-05-01T10:00:00.000+0200", "2024-05-01T10:00:00.000+0200"],
    ["2024-05-01T10:00:00.000-0530", "2024-05-01T10:00:00.000-0530"],
    ["2024-05-01T10:00:00Z", "2024-05-01T10:00:00.000+0000"],
    ["2024-05-01T10:00:00.5Z", "2024-05-01T10:00:00.500+0000"],
    ["2024-05-01T10:00:00.12Z", "2024-05-01T10:00:00.120+0000"],
    ["2024-05-01T10:00:00.123456789+02:00", "2024-05-01T10:00:00.123+0200"],
    ["2024-05-01T10:00:00+02:00", "2024-05-01T10:00:00.000+0200"],
    ["2024-05-01T10:00:00-0130", "2024-05-01T10:00:00.000-0130"],
    ["2024-05-01T10:00Z", "2024-05-01T10:00:00.000+0000"],
    ["2024-05-01T10:00+02:00", "2024-05-01T10:00:00.000+0200"],
    ["2024-05-01T10:00", "2024-05-01T10:00:00.000+0000"],
    ["2024-05-01T10:00:00", "2024-05-01T10:00:00.000+0000"],
    ["2024-05-01", "2024-05-01T00:00:00.000+0000"],
    ["2024-02-29", "2024-02-29T00:00:00.000+0000"],
    ["2000-02-29T23:59:59.999Z", "2000-02-29T23:59:59.999+0000"],
    ["2023-12-31T00:00:00-23:59", "2023-12-31T00:00:00.000-2359"],
    ["0000-01-01", "0000-01-01T00:00:00.000+0000"],
    ["2024-01-31", "2024-01-31T00:00:00.000+0000"],
    ["2023-02-28", "2023-02-28T00:00:00.000+0000"],
    ["2024-04-30", "2024-04-30T00:00:00.000+0000"],
    ["2024-12-31", "2024-12-31T00:00:00.000+0000"],
  ])("converts %s", (input, expected) => {
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBe(expected)
  })

  it.each([
    "",
    "yesterday",
    "2024-5-1",
    "24-05-01",
    "2024-05-01T10",
    "2024-05-01 10:00:00",
    "2024-05-01t10:00:00z",
    "2024-05-01T10:00:00.Z",
    "2024-05-01T10:00:00+2",
    "2024-05-01T10:00:00+02",
    "2024-05-01T10:00:00+02:000",
    "2024-05-01Z",
    " 2024-05-01",
    "x2024-05-01",
    "abc2001-05-01",
    "2024-05-01 ",
    "2024-00-10",
    "2024-13-10",
    "2024-01-00",
    "2024-01-32",
    "2023-02-29",
    "1900-02-29",
    "2024-04-31",
    "2024-06-31",
    "2024-09-31",
    "2024-11-31",
    "2024-05-01T24:00",
    "2024-05-01T10:60",
    "2024-05-01T10:00:60",
    "2024-05-01T10:00:00+24:00",
    "2024-05-01T10:00:00+0060",
  ])("refuses %j", (input) => {
    expect(engineDateInput(input, UTC_WITHOUT_OFFSET)).toBeUndefined()
    expect(isEngineDateInput(input, UTC_WITHOUT_OFFSET)).toBe(false)
  })

  it("reads a time without an offset as UTC", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("0001-01-01T00:00:00Z"),
          max: new Date("9999-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.constantFrom(10, 16, 19, 23),
        (date, length) => {
          const raw = date.toISOString().slice(0, length)
          const asUtc = length === 10 ? `${raw}T00:00:00Z` : `${raw}Z`
          const engine = engineDateInput(raw, UTC_WITHOUT_OFFSET)
          expect(engine && instantOf(engine)).toBe(Date.parse(asUtc))
        },
      ),
    )
  })
})
