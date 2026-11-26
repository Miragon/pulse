import { describe, expect, it } from "vitest"
import { WebApiError } from "@miragon/pulse-widget-shell/widgets"
import { hasVerdict, verdictOf } from "../src/screens/engine/verdict-feed.js"

/**
 * An engine's live state as the page shows it from its verdict's read: the server's verdict, the
 * engine module's words of a failed read (never the verdict read before it), none where the server
 * decides none.
 */

const unreachable = new Error("[unreachable] connection to engine prod failed (engine prod)")
const forbidden = new Error("[403 Forbidden] The engine refused the server's access (engine prod)")
const ended = new WebApiError(401, { code: "signed_out", message: "No session." })

const read = (
  data: { status: "ok" | "warning" | "critical" } | undefined,
  error: Error | null = null,
  failureReason: Error | null = null,
) => ({ data, error, failureReason })

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

describe("hasVerdict", () => {
  it("is Camunda 7's alone, and no dialect's the list does not name", () => {
    expect(["c7", "c8", undefined].map(hasVerdict)).toEqual([true, false, false])
  })
})
