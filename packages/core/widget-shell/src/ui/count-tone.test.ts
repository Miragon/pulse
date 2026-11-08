import { describe, expect, it } from "vitest"
import { countTone, severityTone } from "./count-tone.js"

/** One sign, one meaning (#322 U14, decision f): the ladder every connector reads its counts by. */
describe("countTone", () => {
  it("is danger while there is any open incident or job without retries", () => {
    expect(countTone(1)).toBe("danger")
    expect(countTone(42)).toBe("danger")
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

  it("is neutral over a deployment nothing runs on, success otherwise", () => {
    expect(severityTone(0, 0, 0)).toBe("neutral")
    expect(severityTone(0, 0, 3)).toBe("success")
  })
})
