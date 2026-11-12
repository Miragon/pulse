// Ported from the C8 adapter of Pulse for VS Code (#543, Thomas Heinrichs:
// test/adapters/c8/c8-token-retry-after.test.ts), onto the headers of an answer.
import { describe, expect, test } from "vitest"
import { retryAfterMs } from "../../src/oauth/retry-after.js"

const NOW = Date.UTC(2026, 10, 5, 20, 0, 0)
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

function waitOf(headers: Record<string, string>, now = NOW): number | undefined {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )
  return retryAfterMs(lower, now)
}

describe("the wait a Retry-After asks for", () => {
  test.each([
    ["120", 120_000],
    ["007", 7_000],
    ["31536000", 31_536_000_000],
    ["10000000000", 10_000_000_000_000],
  ])("reads %j as seconds, however long", (value, waitMs) => {
    expect(waitOf({ "Retry-After": value })).toBe(waitMs)
  })

  test.each(["0", "000", "1e3", "0x10", "-5", "+5", "1.5", "Infinity", "120 seconds", ""])(
    "reads %j as no wait",
    (value) => {
      expect(waitOf({ "Retry-After": value })).toBeUndefined()
    },
  )

  test("reads a missing header as no wait", () => {
    expect(waitOf({})).toBeUndefined()
  })

  test.each([
    ["an IMF-fixdate", "Thu, 05 Nov 2026 21:00:00 GMT"],
    ["an RFC 850 date", "Thursday, 05-Nov-26 21:00:00 GMT"],
    ["an asctime date, as GMT", "Thu Nov  5 21:00:00 2026"],
    ["an asctime date with a two-digit day", "Thu Nov 05 21:00:00 2026"],
  ])("reads %s an hour ahead as an hour", (_form, value) => {
    expect(waitOf({ "Retry-After": value })).toBe(HOUR_MS)
  })

  test("reads the day, the month and the time of a date", () => {
    expect(waitOf({ "Retry-After": "Mon, 16 Nov 2026 21:30:15 GMT" })).toBe(
      Date.UTC(2026, 10, 16, 21, 30, 15) - NOW,
    )
    expect(waitOf({ "Retry-After": "Fri Jan  1 00:00:00 2027" })).toBe(Date.UTC(2027, 0, 1) - NOW)
  })

  test("measures a date against the answer's own Date, so a skewed local clock changes nothing", () => {
    const headers = {
      "Retry-After": "Thu, 05 Nov 2026 20:10:00 GMT",
      Date: "Thu, 05 Nov 2026 20:00:00 GMT",
    }

    expect(waitOf(headers, NOW - 30 * MINUTE_MS)).toBe(10 * MINUTE_MS)
    expect(waitOf(headers, NOW + 30 * MINUTE_MS)).toBe(10 * MINUTE_MS)
  })

  test.each([
    ["an RFC 850 date", "Thursday, 05-Nov-26 20:00:00 GMT"],
    ["an asctime date", "Thu Nov  5 20:00:00 2026"],
  ])("reads a Date header that is %s", (_form, date) => {
    const headers = { "Retry-After": "Thu, 05 Nov 2026 20:10:00 GMT", Date: date }

    expect(waitOf(headers, NOW - 45 * MINUTE_MS)).toBe(10 * MINUTE_MS)
  })

  test.each([
    ["no Date header", {}],
    ["an unreadable Date header", { Date: "yesterday" }],
  ])("measures a date against the local clock with %s", (_name, date) => {
    const headers = { "Retry-After": "Thu, 05 Nov 2026 20:10:00 GMT", ...date }

    expect(waitOf(headers, NOW + 5 * MINUTE_MS)).toBe(5 * MINUTE_MS)
  })

  test.each([
    ["a past date", { "Retry-After": "Thu, 05 Nov 2026 19:00:00 GMT" }],
    ["the current time", { "Retry-After": "Thu, 05 Nov 2026 20:00:00 GMT" }],
    [
      "a date before the answer's own Date",
      { "Retry-After": "Thu, 05 Nov 2026 20:10:00 GMT", Date: "Thu, 05 Nov 2026 20:30:00 GMT" },
    ],
    [
      "a year of two digits from the last century",
      { "Retry-After": "Sunday, 06-Nov-94 08:49:37 GMT" },
    ],
  ])("reads %s as no wait", (_name, headers) => {
    expect(waitOf(headers)).toBeUndefined()
  })

  test("reads a year of two digits as at most 50 years ahead", () => {
    expect(waitOf({ "Retry-After": "Thursday, 05-Nov-76 20:00:00 GMT" })).toBe(
      Date.UTC(2076, 10, 5, 20) - NOW,
    )
    expect(waitOf({ "Retry-After": "Friday, 05-Nov-77 20:00:00 GMT" })).toBeUndefined()
  })

  test.each([
    "Thu, 05 Nov 2026 21:00:00",
    "Thu, 05 Nov 2026 21:00:00 CET",
    "Thu, 32 Nov 2026 21:00:00 GMT",
    "Thu, 00 Nov 2026 21:00:00 GMT",
    "Thu, 05 Nov 2026 24:00:00 GMT",
    "Thu, 05 Nov 2026 21:60:00 GMT",
    "Thu, 05 Foo 2026 21:00:00 GMT",
    "Thu, 5 Nov 2026 21:00:00 GMT",
    "thu, 05 nov 2026 21:00:00 gmt",
    "Thursday, 05 Nov 2026 21:00:00 GMT",
    "Thu, 05-Nov-26 21:00:00 GMT",
    "Thursday, 05-Nov-2026 21:00:00 GMT",
    "Thu Nov 5 21:00:00 2026",
    "Thu Nov  5 21:00:00 2026 GMT",
    "2026-11-05T21:00:00Z",
    "in an hour",
  ])("reads the malformed date %j as no wait", (value) => {
    expect(waitOf({ "Retry-After": value })).toBeUndefined()
  })

  test("reads every month by its name", () => {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    months.forEach((month, index) => {
      expect(waitOf({ "Retry-After": `Mon, 01 ${month} 2027 00:00:00 GMT` })).toBe(
        Date.UTC(2027, index, 1) - NOW,
      )
    })
  })
})
