import { PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { OffsetPaging } from "./offset-paging.js"

describe("OffsetPaging.window", () => {
  it("asks for the first page and one row more without a cursor", () => {
    expect(new OffsetPaging({ limit: 3 }).window()).toStrictEqual({
      firstResult: 0,
      maxResults: 4,
    })
  })

  it.each(["0", "40"])("starts at the offset the cursor %s names", (cursor) => {
    expect(new OffsetPaging({ limit: 3, after: PageCursor(cursor) }).window()).toStrictEqual({
      firstResult: Number(cursor),
      maxResults: 4,
    })
  })

  it.each(["-1", "1.5", "next", "9007199254740992"])(
    "fails the cursor %s, which is no offset of this paging",
    (cursor) => {
      const paging = new OffsetPaging({ limit: 3, after: PageCursor(cursor) })
      expect(() => paging.window()).toThrow(
        new RangeError(`"${cursor}" is not a page cursor of this engine`),
      )
    },
  )
})

describe("OffsetPaging.pageOf", () => {
  const twice = (rows: readonly number[]) => rows.map((row) => row * 2)

  it("is the last page when the engine answered no more rows than the page holds", () => {
    expect(new OffsetPaging({ limit: 3 }).pageOf([1, 2], twice)).toStrictEqual({ items: [2, 4] })
    expect(new OffsetPaging({ limit: 3 }).pageOf([1, 2, 3], twice)).toStrictEqual({
      items: [2, 4, 6],
    })
  })

  it("maps the page's rows only and names the offset of the next page when one more came", () => {
    const paging = new OffsetPaging({ limit: 3, after: PageCursor("6") })
    const seen: (readonly number[])[] = []
    const page = paging.pageOf([1, 2, 3, 4], (rows) => {
      seen.push(rows)
      return twice(rows)
    })
    expect(page).toStrictEqual({ items: [2, 4, 6], next: PageCursor("9") })
    expect(seen).toStrictEqual([[1, 2, 3]])
  })
})
