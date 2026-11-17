import { describe, expect, it } from "vitest"
import { endedSessions, MAX_ENDED_SESSIONS } from "./ended.js"

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

describe("endedSessions: the sessions signed out at this replica", () => {
  it("knows a session from its sign-out until its seal expires, and no other", () => {
    const ended = endedSessions()
    expect(ended.has("s1", NOW)).toBe(false)
    ended.end("s1", NOW + HOUR, NOW)
    expect(ended.has("s1", NOW)).toBe(true)
    expect(ended.has("s1", NOW + HOUR - 1)).toBe(true)
    expect(ended.has("s1", NOW + HOUR)).toBe(false)
    expect(ended.has("s2", NOW)).toBe(false)
  })

  it("keeps at most its limit, the oldest sign-out going first", () => {
    const ended = endedSessions(2)
    for (const id of ["s1", "s2", "s3"]) ended.end(id, NOW + HOUR, NOW)
    expect(["s1", "s2", "s3"].map((id) => ended.has(id, NOW))).toEqual([false, true, true])
  })

  it("drops a session whose seal expired before it counts the limit", () => {
    const ended = endedSessions(2)
    ended.end("long", NOW + 8 * HOUR, NOW)
    ended.end("short", NOW + HOUR, NOW)
    // At the short one's expiry it goes, so the long one, signed out first, stays.
    ended.end("next", NOW + 8 * HOUR, NOW + HOUR)
    expect(["long", "short", "next"].map((id) => ended.has(id, NOW + HOUR))).toEqual([
      true,
      false,
      true,
    ])
  })

  it("keeps a hundred thousand by default", () => {
    expect(MAX_ENDED_SESSIONS).toBe(100_000)
    const ended = endedSessions()
    for (let index = 0; index <= MAX_ENDED_SESSIONS; index += 1) {
      ended.end(`s${index}`, NOW + HOUR, NOW)
    }
    expect(ended.has("s0", NOW)).toBe(false)
    expect(ended.has("s1", NOW)).toBe(true)
    expect(ended.has(`s${MAX_ENDED_SESSIONS}`, NOW)).toBe(true)
  })
})
