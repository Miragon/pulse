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

describe("endedSessions: the refresh tokens this replica revoked", () => {
  it("answers true once per token until its session's seal expires, then again", () => {
    const ended = endedSessions()
    expect(ended.revokes("d1", NOW + HOUR, NOW)).toBe(true)
    expect(ended.revokes("d1", NOW + HOUR, NOW + HOUR - 1)).toBe(false)
    expect(ended.revokes("d2", NOW + HOUR, NOW)).toBe(true)
    expect(ended.revokes("d1", NOW + 2 * HOUR, NOW + HOUR)).toBe(true)
    expect(ended.revokes("d1", NOW + 2 * HOUR, NOW + HOUR)).toBe(false)
  })

  it("keeps its tokens apart from the sessions, each at most the limit", () => {
    const ended = endedSessions(2)
    ended.end("s1", NOW + HOUR, NOW)
    for (const digest of ["d1", "d2", "d3"]) ended.revokes(digest, NOW + HOUR, NOW)
    expect(ended.has("s1", NOW)).toBe(true)
    expect(ended.has("d2", NOW)).toBe(false)
    // The oldest went: the two kept stay revoked, the first is this replica's to revoke again.
    expect(["d2", "d3", "d1"].map((digest) => ended.revokes(digest, NOW + HOUR, NOW))).toEqual([
      false,
      false,
      true,
    ])
  })

  it("keeps a hundred thousand by default", () => {
    const ended = endedSessions()
    for (let index = 0; index <= MAX_ENDED_SESSIONS; index += 1) {
      ended.revokes(`d${index}`, NOW + HOUR, NOW)
    }
    expect(ended.revokes(`d${MAX_ENDED_SESSIONS}`, NOW + HOUR, NOW)).toBe(false)
    expect(ended.revokes("d1", NOW + HOUR, NOW)).toBe(false)
    expect(ended.revokes("d0", NOW + HOUR, NOW)).toBe(true)
  })
})
