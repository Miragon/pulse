import { expect, it } from "vitest"
import { instantOf, wallClockOf } from "../src/router/wall-clock.js"
import { inZone, OTHER_ZONES } from "./time-zones.test-support.js"

/**
 * A date of a variable condition between the dialog's wall clock and the instant the address
 * carries (`src/router/wall-clock.ts`), pinned in UTC and in the two zones of the time-zone cases,
 * each on both sides of its change to summer time and at the hour the change skips or repeats. The
 * cases of the router and the process screen run on every clock against the browser's own reading
 * of a date; these hold the instants themselves.
 */

interface Clock {
  /** A wall clock and the instant it names there, which reads back as that wall clock. */
  readonly both: ReadonlyArray<readonly [string, string]>
  /** What `2026-03-30T10:00+02:00`, an instant with an offset, reads as there. */
  readonly withOffset: string
  /** The zone's change to summer time and back, where it has one. */
  readonly change?: {
    /** A wall clock the change skips, its instant and how that reads back: an hour later. */
    readonly skipped: readonly [string, string, string]
    /** A wall clock the change back repeats, the first instant it names and the second one. */
    readonly repeated: readonly [string, string, string]
  }
}

const CLOCKS: Record<string, Clock> = {
  UTC: {
    both: [
      ["2026-03-15T10:00", "2026-03-15T10:00:00.000Z"],
      ["2026-07-01T23:30:15", "2026-07-01T23:30:15.000Z"],
    ],
    withOffset: "2026-03-30T08:00",
  },
  "Europe/Berlin": {
    both: [
      // UTC+1 until 29 March, then UTC+2; past midnight the day before in UTC.
      ["2026-03-15T10:00", "2026-03-15T09:00:00.000Z"],
      ["2026-03-30T10:00", "2026-03-30T08:00:00.000Z"],
      ["2026-03-30T01:15:30", "2026-03-29T23:15:30.000Z"],
    ],
    withOffset: "2026-03-30T10:00",
    change: {
      skipped: ["2026-03-29T02:30", "2026-03-29T01:30:00.000Z", "2026-03-29T03:30"],
      repeated: ["2026-10-25T02:30", "2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
    },
  },
  "America/Los_Angeles": {
    both: [
      // UTC-8 until 8 March, then UTC-7; in the evening the next day in UTC.
      ["2026-03-01T10:00", "2026-03-01T18:00:00.000Z"],
      ["2026-03-15T10:00", "2026-03-15T17:00:00.000Z"],
      ["2026-03-15T20:45:10", "2026-03-16T03:45:10.000Z"],
    ],
    withOffset: "2026-03-30T01:00",
    change: {
      skipped: ["2026-03-08T02:30", "2026-03-08T10:30:00.000Z", "2026-03-08T03:30"],
      repeated: ["2026-11-01T01:30", "2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"],
    },
  },
}

it("pins UTC and every zone the time-zone cases run in", () => {
  expect(Object.keys(CLOCKS)).toEqual(["UTC", ...OTHER_ZONES])
})

for (const [zone, { both, withOffset, change }] of Object.entries(CLOCKS)) {
  inZone(zone, () => {
    it("names the instant of a wall clock and reads it back, its seconds only where it has some", () => {
      for (const [wall, instant] of both) {
        expect(instantOf(wall), wall).toBe(instant)
        expect(wallClockOf(instant), instant).toBe(wall)
      }
      expect(wallClockOf("2026-03-30T10:00+02:00")).toBe(withOffset)
    })

    if (change === undefined) return
    it("reads a wall clock the change to summer time skips an hour later, and a repeated one as the first", () => {
      const [skipped, after, readBack] = change.skipped
      const [repeated, first, second] = change.repeated
      expect(instantOf(skipped)).toBe(after)
      expect(wallClockOf(after)).toBe(readBack)
      expect(instantOf(repeated)).toBe(first)
      // Both instants of the repeated hour show the same wall clock.
      expect([wallClockOf(first), wallClockOf(second)]).toEqual([repeated, repeated])
    })
  })
}
