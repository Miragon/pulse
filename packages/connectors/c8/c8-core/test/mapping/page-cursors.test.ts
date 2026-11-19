import { PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { PageCursors } from "../../src/mapping/page-cursors.js"

describe("the page cursors", () => {
  test("carry the rows seen so far and the cluster's cursor, which may hold a colon", () => {
    const cursor = PageCursors.next(50, "WzE3MzA4MDAwMDAwMDAsIjIyNTE3OTk4MTM2ODU2MDAiXQ==:x")

    expect(cursor).toBe("50:WzE3MzA4MDAwMDAwMDAsIjIyNTE3OTk4MTM2ODU2MDAiXQ==:x")
    expect(PageCursors.seenBefore(cursor)).toBe(50)
    expect(PageCursors.windowOf(25, cursor)).toStrictEqual({
      limit: 25,
      after: "WzE3MzA4MDAwMDAwMDAsIjIyNTE3OTk4MTM2ODU2MDAiXQ==:x",
    })
  })

  test.each([
    [undefined],
    [PageCursor("ORD-1")],
    [PageCursor("12:")],
    [PageCursor("x12:a")],
    [PageCursor("12:a\nb")],
  ])("start at the first page for %j", (cursor) => {
    expect(PageCursors.seenBefore(cursor)).toBe(0)
    expect(PageCursors.windowOf(25, cursor)).toStrictEqual({ limit: 25 })
  })
})
