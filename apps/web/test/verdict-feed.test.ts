import { describe, expect, it } from "vitest"
import { WebApiError } from "@miragon/pulse-widget-shell/widgets"
import { hasVerdict, outsideOf, verdictOf } from "../src/screens/engine/verdict-feed.js"

/**
 * An engine's live state as the page shows it from its verdict's read: the server's verdict, the
 * engine module's words of a failed read (never the verdict read before it), none where the server
 * decides none.
 */

const unreachable = new Error("[unreachable] connection to engine prod failed (engine prod)")
const forbidden = new Error("[403 Forbidden] The engine refused the server's access (engine prod)")
const ended = new WebApiError(401, { code: "signed_out", message: "No session." })

/** None outside any process, read whole. */
const NONE = { count: 0, atLeast: false }

const read = (
  data: { status: "ok" | "warning" | "critical"; outsideAnyProcess?: typeof NONE } | undefined,
  error: Error | null = null,
  failureReason: Error | null = null,
) => ({ data: data && { outsideAnyProcess: NONE, ...data }, error, failureReason })

describe("verdictOf", () => {
  it("is none where the server decides no verdict for the engine, whatever was read", () => {
    expect(verdictOf(read({ status: "critical" }), false)).toBe("none")
    expect(verdictOf(undefined, false)).toBe("none")
  })

  it("reads while nothing answered, and is the server's verdict once it did", () => {
    expect(verdictOf(undefined, true)).toBe("loading")
    expect(verdictOf(read(undefined), true)).toBe("loading")
    expect(verdictOf(read({ status: "warning" }), true)).toBe("warning")
  })

  it("is the failure of the last read, never the verdict read before it", () => {
    expect(verdictOf(read({ status: "ok" }, unreachable), true)).toBe("unreachable")
    expect(verdictOf(read(undefined, forbidden), true)).toBe("forbidden")
  })

  it("says a first attempt's failure while the query client retries, unless a verdict shows", () => {
    expect(verdictOf(read(undefined, null, unreachable), true)).toBe("unreachable")
    expect(verdictOf(read({ status: "ok" }, null, unreachable), true)).toBe("ok")
  })

  it("leaves a page's ended session quiet: nothing was read of the engine", () => {
    expect(verdictOf(read(undefined, ended), true)).toBe("unread")
    expect(verdictOf(read(undefined, null, ended), true)).toBe("unread")
  })
})

describe("outsideOf", () => {
  const one = { count: 1, atLeast: false }
  const degraded = { status: "warning", outsideAnyProcess: one } as const

  it("is the root incidents outside any process of the verdict shown", () => {
    expect(outsideOf(read(degraded), true)).toEqual(one)
    expect(outsideOf(read({ status: "ok" }), true)).toEqual(NONE)
    // A first attempt's failure while the query client retries: the verdict shows, and they too.
    expect(outsideOf(read(degraded, null, unreachable), true)).toEqual(one)
  })

  it("is none where no verdict shows: none decided, still reading, a failed read", () => {
    expect(outsideOf(read(degraded), false)).toBeUndefined()
    expect(outsideOf(undefined, true)).toBeUndefined()
    expect(outsideOf(read(undefined), true)).toBeUndefined()
    expect(outsideOf(read(degraded, unreachable), true)).toBeUndefined()
  })
})

describe("hasVerdict", () => {
  it("is Camunda 7's alone, and no dialect's the list does not name", () => {
    expect(["c7", "c8", undefined].map(hasVerdict)).toEqual([true, false, false])
  })
})
