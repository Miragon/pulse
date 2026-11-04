import { describe, expect, it } from "vitest"
import { periodCompareInput } from "./period-compare.js"

const DEPLOY = "2026-03-10T12:00:00.000Z"

describe("periodCompareInput", () => {
  /** A week before the deployment against the week after it. */
  const periods = {
    periodAFrom: "2026-03-03T12:00:00.000Z",
    periodATo: DEPLOY,
    periodBFrom: DEPLOY,
    periodBTo: "2026-03-17T12:00:00.000Z",
  }

  it("accepts ISO datetimes including the engine's local-offset format", () => {
    expect(periodCompareInput.safeParse(periods).success).toBe(true)
    expect(
      periodCompareInput.safeParse({ ...periods, periodBFrom: "2026-03-10T14:00:00.000+0200" })
        .success,
    ).toBe(true)
  })

  it("rejects non-datetime strings at the tool boundary", () => {
    const res = periodCompareInput.safeParse({ ...periods, periodAFrom: "last week" })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].message).toMatch(/parseable ISO datetime/)
    }
  })
})
