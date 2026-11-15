import { PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { FillingPages } from "./filling-pages.js"
import type { OffsetWindow } from "./offset-paging.js"

/** An engine whose rows are letters: a lower-case one is kept, an upper-case one dropped. */
function engineOf(rows: string) {
  const windows: OffsetWindow[] = []
  const read = (window: OffsetWindow) => {
    windows.push(window)
    const answer = rows.slice(window.firstResult, window.firstResult + window.maxResults)
    return Promise.resolve(
      Array.from(answer, (row) => (row === row.toLowerCase() ? row : undefined)),
    )
  }
  return { windows, read }
}

describe("FillingPages.pageOf", () => {
  it("reads one window of the page and one row more when it keeps enough", async () => {
    const engine = engineOf("abcd")

    const page = await new FillingPages({ limit: 2 }).pageOf(engine.read)

    expect(page).toStrictEqual({ items: ["a", "b"], next: PageCursor("2") })
    expect(engine.windows).toStrictEqual([{ firstResult: 0, maxResults: 3 }])
  })

  it("names the offset of the next kept row, not of the row after the page", async () => {
    const engine = engineOf("aBc")

    const page = await new FillingPages({ limit: 1 }).pageOf(engine.read)

    expect(page).toStrictEqual({ items: ["a"], next: PageCursor("2") })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 2 },
      { firstResult: 2, maxResults: 4 },
    ])
  })

  it("starts at the offset the cursor names", async () => {
    const engine = engineOf("abcdef")

    const page = await new FillingPages({ limit: 2, after: PageCursor("3") }).pageOf(engine.read)

    expect(page).toStrictEqual({ items: ["d", "e"], next: PageCursor("5") })
    expect(engine.windows).toStrictEqual([{ firstResult: 3, maxResults: 3 }])
  })

  it("fills the page past the dropped rows and never reads them again", async () => {
    const engine = engineOf("ABaCDEb")

    const first = await new FillingPages({ limit: 1 }).pageOf(engine.read)
    const second = await new FillingPages({ limit: 1, after: PageCursor("6") }).pageOf(engine.read)

    expect(first).toStrictEqual({ items: ["a"], next: PageCursor("6") })
    expect(second).toStrictEqual({ items: ["b"] })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 2 },
      { firstResult: 2, maxResults: 4 },
      { firstResult: 6, maxResults: 8 },
      { firstResult: 6, maxResults: 2 },
    ])
  })

  it("names no next page when the last window came back short", async () => {
    const engine = engineOf("aBCD")

    expect(await new FillingPages({ limit: 2 }).pageOf(engine.read)).toStrictEqual({
      items: ["a"],
    })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 3 },
      { firstResult: 3, maxResults: 6 },
    ])
  })

  it("reads one window more after a full one, which may hold no row", async () => {
    const engine = engineOf("aB")

    expect(await new FillingPages({ limit: 1 }).pageOf(engine.read)).toStrictEqual({
      items: ["a"],
    })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 2 },
      { firstResult: 2, maxResults: 4 },
    ])
  })

  it("doubles each further window up to 500 rows and stops at the tenth, its cursor the first row not read", async () => {
    const engine = engineOf(`${"A".repeat(1509)}ab`)

    const page = await new FillingPages({ limit: 1 }).pageOf(engine.read)

    expect(page).toStrictEqual({ items: ["a"], next: PageCursor("1510") })
    expect(engine.windows.map((window) => window.maxResults)).toStrictEqual([
      2, 4, 8, 16, 32, 64, 128, 256, 500, 500,
    ])
    expect(engine.windows.at(-1)).toStrictEqual({ firstResult: 1010, maxResults: 500 })
  })

  it("names no next page at the tenth window when it came back short", async () => {
    const engine = engineOf(`${"A".repeat(1500)}a`)

    expect(await new FillingPages({ limit: 1 }).pageOf(engine.read)).toStrictEqual({
      items: ["a"],
    })
    expect(engine.windows).toHaveLength(10)
  })

  it("reads further windows of 500 rows after a first one larger than that", async () => {
    const engine = engineOf(`${"A".repeat(700)}abc`)

    const page = await new FillingPages({ limit: 600 }).pageOf(engine.read)

    expect(page).toStrictEqual({ items: ["a", "b", "c"] })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 601 },
      { firstResult: 601, maxResults: 500 },
    ])
  })

  it("fails a cursor that is no offset of this paging before it reads", async () => {
    const engine = engineOf("abc")

    await expect(
      new FillingPages({ limit: 1, after: PageCursor("x") }).pageOf(engine.read),
    ).rejects.toThrow(new RangeError('"x" is not a page cursor of this engine'))
    expect(engine.windows).toStrictEqual([])
  })
})
