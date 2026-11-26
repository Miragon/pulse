import { afterAll, beforeAll, describe, expect } from "vitest"

/**
 * The clocks a case that converts between this browser's wall clock and an instant runs on (the
 * page's `src/router/wall-clock.ts`). CI and the agent VMs run in UTC, where the two are the same,
 * so the runner's clock alone would hide a conversion that drops the offset. Berlin is east of
 * UTC and Los Angeles west of it, and each changes to summer time on a date of its own: Berlin on
 * 29 March 2026 and back on 25 October, Los Angeles on 8 March and back on 1 November.
 */
export const OTHER_ZONES = ["Europe/Berlin", "America/Los_Angeles"] as const

/**
 * Describes `cases` on a clock in `zone`: Node reads the zone from `TZ` anew whenever it is
 * assigned, so the dates the cases build and the page's code they call convert there. The
 * runner's zone comes back after them.
 */
export function inZone(zone: string, cases: () => void): void {
  describe(`in ${zone}`, () => {
    let runner: string | undefined
    beforeAll(() => {
      runner = process.env.TZ
      process.env.TZ = zone
      // A zone Node did not take would run the cases on the runner's clock without a word.
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    })
    afterAll(() => {
      if (runner === undefined) delete process.env.TZ
      else process.env.TZ = runner
    })
    cases()
  })
}

/** Describes `cases` on the runner's clock and again in each of OTHER_ZONES. */
export function onEveryClock(cases: () => void): void {
  describe("on the runner's clock", cases)
  for (const zone of OTHER_ZONES) inZone(zone, cases)
}
