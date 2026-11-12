import { describe, expect, it } from "vitest"
import { countTone, isToneVariant, severityTone, SITUATION_TONES } from "./index.js"

/**
 * One table for every Pulse UI: the MCP widgets and the VS Code webview show the same situation
 * in the same tone (step C2 of the UI foundation, 2026-11-08: owner decision E4 puts the table into
 * pulse-ui, the form proposal the owner took keeps it free of a green "healthy"). The VS Code
 * webview's `test/webview/situation-tones.test.tsx` holds its state labels and diagram badges to it.
 */
describe("the situation table", () => {
  it("gives every situation one of the five tones", () => {
    for (const [situation, tone] of Object.entries(SITUATION_TONES)) {
      expect(isToneVariant(tone), situation).toBe(true)
    }
  })

  it("pins the ladder: what waits for a person is danger, what recovers on its own warning", () => {
    expect(SITUATION_TONES).toEqual({
      openIncident: "danger",
      incidentInCalledInstance: "danger",
      jobWithoutRetries: "danger",
      jobWithRetriesLeft: "warning",
      running: "info",
      suspended: "neutral",
      ended: "neutral",
      healthy: "neutral",
      idle: "neutral",
    })
  })

  it('never shows a situation in green: no green "healthy"', () => {
    expect(Object.values(SITUATION_TONES)).not.toContain("success")
  })
})

/** One sign, one meaning (#322 U14, decision f): the ladder every connector reads its counts by. */
describe("countTone", () => {
  it("is the open incident's tone while there is any open incident or job without retries", () => {
    expect(countTone(1)).toBe(SITUATION_TONES.openIncident)
    expect(countTone(42)).toBe("danger")
    expect(SITUATION_TONES.jobWithoutRetries).toBe(SITUATION_TONES.openIncident)
  })

  it("is a neutral number for none, and for a count nobody measured", () => {
    expect(countTone(0)).toBe("neutral")
    expect(countTone(null)).toBe("neutral")
    expect(countTone(undefined)).toBe("neutral")
  })
})

describe("severityTone", () => {
  it("is danger for an open incident or a job without retries", () => {
    expect(severityTone(0, 1, 10)).toBe("danger")
    expect(severityTone(1, 0, 10)).toBe("danger")
    // Even over an idle deployment: the incident outlives its instances.
    expect(severityTone(1, 0, 0)).toBe("danger")
  })

  it("is neutral over a deployment nothing runs on and over one that runs without a problem", () => {
    expect(severityTone(0, 0, 0)).toBe(SITUATION_TONES.idle)
    expect(severityTone(0, 0, 3)).toBe(SITUATION_TONES.healthy)
    expect(severityTone(0, 0, 3)).toBe("neutral")
  })
})
