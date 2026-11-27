import { PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { OffsetWindow } from "./port.js"
import { turnTies } from "./testing/fake-port.js"
import { type TiedRow, TiedPages } from "./tied-pages.js"

/**
 * An engine whose rows are written `<key><id>` and ordered by key alone, every run of tied rows
 * turned one further on each request; an upper-case id is a row the page drops.
 */
function turningEngine(written: string) {
  const rows = written.split(" ").map((token) => {
    const [, key = "", id = ""] = /^(\d+)(\D+)$/.exec(token) ?? []
    return { key, id, item: id === id.toLowerCase() ? id : undefined }
  })
  let requests = 0
  return (window: OffsetWindow): Promise<readonly TiedRow<string>[]> => {
    const answer = turnTies(rows, (row) => row.key, requests)
    requests += 1
    return Promise.resolve(answer.slice(window.firstResult, window.firstResult + window.maxResults))
  }
}

const WRITTEN = "9a 7d 7b 7C 7e 7f 5g 5H 5h 3j 3i 1k"

describe("TiedPages.cursoredPageOf", () => {
  it("gives each item the cursor of a page that starts with it, the page pageOf gives", async () => {
    const read = turningEngine(WRITTEN)

    const cursored = await new TiedPages({ limit: 4 }).cursoredPageOf(read)
    const plain = await new TiedPages({ limit: 4 }).pageOf(read)

    expect(cursored).toStrictEqual({
      items: [
        { item: "a", at: PageCursor("0") },
        // The run of 7 by id: C (dropped) first, then b.
        { item: "b", at: PageCursor("1.1") },
        { item: "d", at: PageCursor("1.2") },
        { item: "e", at: PageCursor("1.3") },
      ],
      next: PageCursor("1.4"),
    })
    expect(plain).toStrictEqual({ items: ["a", "b", "d", "e"], next: PageCursor("1.4") })
  })

  it("starts a page with the item at each cursor, across every page", async () => {
    const read = turningEngine(WRITTEN)
    const items: { item: string; at: PageCursor }[] = []
    let after: PageCursor | undefined
    do {
      const page = await new TiedPages(
        after === undefined ? { limit: 3 } : { limit: 3, after },
      ).cursoredPageOf(read)
      items.push(...page.items)
      after = page.next
    } while (after !== undefined)

    expect(items.map(({ item }) => item)).toStrictEqual([
      "a",
      "b",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
    ])
    for (const { item, at } of items) {
      const page = await new TiedPages({ limit: 1, after: at }).pageOf(read)
      expect(page.items, `from ${at}`).toStrictEqual([item])
    }
  })

  it("gives the items at the bound of requests their cursors too", async () => {
    // Ten windows of rows the page drops after its one kept row: the page stops at the bound.
    const dropped = Array.from({ length: 3000 }, (_, index) => `${String(5000 - index)}X`)
    const read = turningEngine(["9999a", ...dropped, "1b"].join(" "))

    const page = await new TiedPages({ limit: 2 }).cursoredPageOf(read)

    expect(page.items).toStrictEqual([{ item: "a", at: PageCursor("0") }])
    expect(page.next).toMatch(/^\d+$/)
  })
})

describe("TiedPages.isCursor", () => {
  it.each(["0", "12", "12.3", "4~", "0.0"])("takes %j", (after) => {
    expect(TiedPages.isCursor(after)).toBe(true)
  })

  it.each(["", "x", "1.", "1.2.3", "-1", "1~2", "1.x", "99999999999999999999"])(
    "refuses %j",
    (after) => {
      expect(TiedPages.isCursor(after)).toBe(false)
    },
  )
})
