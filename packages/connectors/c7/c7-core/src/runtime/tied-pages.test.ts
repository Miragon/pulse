import { PageCursor, type PageRequest } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { OffsetWindow } from "./offset-paging.js"
import { type TiedRow, TiedPages } from "./tied-pages.js"

/**
 * An engine whose rows are written `<key><id>`, ordered by key alone as given: `3a 2b 2c 1d` holds
 * a, then b and c tied, then d. An upper-case id is a row the page drops. With `turning`, each
 * request turns every run of tied rows one further, as a database may order ties anew.
 */
function engineOf(written: string, options: { turning?: boolean } = {}) {
  const rows = written.split(" ").map((token) => {
    const [, key = "", id = ""] = /^(\d+)(\D+)$/.exec(token) ?? []
    return { key, id, item: id === id.toLowerCase() ? id : undefined }
  })
  const windows: OffsetWindow[] = []
  const read = (window: OffsetWindow): Promise<readonly TiedRow<string>[]> => {
    const turn = windows.length
    windows.push(window)
    const answer = options.turning === true ? turned(rows, turn) : rows
    return Promise.resolve(answer.slice(window.firstResult, window.firstResult + window.maxResults))
  }
  return { windows, read }
}

/** `rows` with each run of tied rows turned `turn` places. */
function turned<Row extends { readonly key: string }>(rows: readonly Row[], turn: number): Row[] {
  const result: Row[] = []
  for (let start = 0; start < rows.length;) {
    let end = start
    while (end < rows.length && rows[end]?.key === rows[start]?.key) end += 1
    const run = rows.slice(start, end)
    const by = turn % run.length
    result.push(...run.slice(by), ...run.slice(0, by))
    start = end
  }
  return result
}

const pageOf = (page: PageRequest, read: ReturnType<typeof engineOf>["read"]) =>
  new TiedPages(page).pageOf(read)

/** Every page from the first on, its items each. */
async function walk(engine: ReturnType<typeof engineOf>, limit: number): Promise<string[][]> {
  const pages: string[][] = []
  let after: PageCursor | undefined
  do {
    const page = await pageOf(after === undefined ? { limit } : { limit, after }, engine.read)
    pages.push([...page.items])
    after = page.next
  } while (after !== undefined && pages.length < 50)
  return pages
}

describe("TiedPages.pageOf", () => {
  it("reads the page and two rows more in one window where nothing ties, its cursor an offset", async () => {
    const engine = engineOf("5a 4b 3c 2d 1e")

    const page = await pageOf({ limit: 2 }, engine.read)

    expect(page).toStrictEqual({ items: ["a", "b"], next: PageCursor("2") })
    expect(engine.windows).toStrictEqual([{ firstResult: 0, maxResults: 4 }])
  })

  it("orders tied rows by id, and names a cursor into their run where the page ends in it", async () => {
    const engine = engineOf("3z 2c 2a 2b 1d")

    const first = await pageOf({ limit: 2 }, engine.read)
    const second = await pageOf({ limit: 2, after: PageCursor("1.1") }, engine.read)

    expect(first).toStrictEqual({ items: ["z", "a"], next: PageCursor("1.1") })
    expect(second).toStrictEqual({ items: ["b", "c"], next: PageCursor("4") })
    // From the run's start, the rows it skips and the page and two more.
    expect(engine.windows.at(-1)).toStrictEqual({ firstResult: 1, maxResults: 5 })
  })

  it("pages without gaps or repeats where the engine orders ties anew on each request", async () => {
    const engine = engineOf("9a 7d 7b 7c 7e 7f 5g 5h 1i", { turning: true })

    expect(await walk(engine, 2)).toStrictEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
      ["i"],
    ])
  })

  it("keeps a run longer than the page in id order across every page it spans", async () => {
    const engine = engineOf("1e 1c 1a 1d 1b", { turning: true })

    expect(await walk(engine, 2)).toStrictEqual([["a", "b"], ["c", "d"], ["e"]])
  })

  it("reads a full window's last run again at the next window's start, since it may go on", async () => {
    const engine = engineOf("4A 3B 2c 2a 2b")

    const page = await pageOf({ limit: 1 }, engine.read)

    expect(page).toStrictEqual({ items: ["a"], next: PageCursor("2.1") })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 3 },
      { firstResult: 2, maxResults: 6 },
    ])
  })

  it("reads a run that fills its window again in one twice as large, from the same row", async () => {
    const engine = engineOf("2c 2b 2a 2d 1e")

    const page = await pageOf({ limit: 1 }, engine.read)

    expect(page).toStrictEqual({ items: ["a"], next: PageCursor("0.1") })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 3 },
      { firstResult: 0, maxResults: 6 },
    ])
  })

  it("stops growing a window at 500 rows for a run longer than that, and reads on after it", async () => {
    const dropped = Array<string>(501).fill("1X")
    const engine = engineOf(["1b", "1a", ...dropped, "0c"].join(" "))

    const page = await pageOf({ limit: 2 }, engine.read)

    expect(page).toStrictEqual({ items: ["a", "b"], next: PageCursor("503") })
    expect(engine.windows.map(({ maxResults }) => maxResults)).toStrictEqual([
      4, 8, 16, 32, 64, 128, 256, 500, 500,
    ])
    expect(engine.windows.at(-1)?.firstResult).toBe(500)
  })

  it("counts dropped rows of a run in its cursor, so the next page skips them too", async () => {
    const engine = engineOf("2c 2A 2b 2B 1d")

    const first = await pageOf({ limit: 1 }, engine.read)
    const second = await pageOf({ limit: 2, after: first.next ?? PageCursor("none") }, engine.read)

    expect(first).toStrictEqual({ items: ["b"], next: PageCursor("0.3") })
    expect(second).toStrictEqual({ items: ["c", "d"] })
  })

  it("skips only in the run the cursor starts in, never in a later one", async () => {
    const engine = engineOf("2b 2a 1d 1c 0e")

    expect(await pageOf({ limit: 3, after: PageCursor("0.1") }, engine.read)).toStrictEqual({
      items: ["b", "c", "d"],
      next: PageCursor("4"),
    })
  })

  it("fills the page past dropped rows from windows twice as large", async () => {
    const engine = engineOf("6A 5B 4c 3d")

    expect(await pageOf({ limit: 1 }, engine.read)).toStrictEqual({
      items: ["c"],
      next: PageCursor("3"),
    })
    expect(engine.windows).toStrictEqual([
      { firstResult: 0, maxResults: 3 },
      { firstResult: 2, maxResults: 6 },
    ])
  })

  it("names no next page when the last window came back short", async () => {
    const engine = engineOf("3a 2b 2c")

    expect(await pageOf({ limit: 3 }, engine.read)).toStrictEqual({ items: ["a", "b", "c"] })
    expect(await pageOf({ limit: 5 }, engineOf("1a").read)).toStrictEqual({ items: ["a"] })
  })

  it("stops at the tenth window, its cursor the first row not read whole, keeping what it read", async () => {
    // Windows of 3, 6, 12 … 384, 500 and 500 rows, each from the last row of the one before:
    // the tenth reads offsets 1256 to 1755, the kept row a and the row b the last two.
    const dropped = Array.from({ length: 1754 }, (_, index) => `${String(9999 - index)}X`)
    const engine = engineOf([...dropped, "2a", "1b"].join(" "))

    expect(await pageOf({ limit: 1 }, engine.read)).toStrictEqual({
      items: ["a"],
      next: PageCursor("1755"),
    })
    expect(engine.windows).toHaveLength(10)
  })

  it("returns an empty page at the bound where no row of the ten windows was kept", async () => {
    const dropped = Array.from({ length: 1800 }, (_, index) => `${String(9999 - index)}X`)

    expect(await pageOf({ limit: 1 }, engineOf(dropped.join(" ")).read)).toStrictEqual({
      items: [],
      next: PageCursor("1755"),
    })
  })

  it.each([
    "x",
    "1.",
    ".1",
    "-1",
    "1.2.3",
    "1e3",
    "1.-1",
    "9007199254740992",
    "9007199254740991.1",
  ])("fails the cursor %s before it reads anything", async (after) => {
    const engine = engineOf("1a")

    await expect(pageOf({ limit: 1, after: PageCursor(after) }, engine.read)).rejects.toThrow(
      new RangeError(`"${after}" is not a page cursor of this engine`),
    )
    expect(engine.windows).toStrictEqual([])
  })

  it.each([
    ["3", { firstResult: 3, maxResults: 3 }],
    ["3.0", { firstResult: 3, maxResults: 3 }],
    ["3.2", { firstResult: 3, maxResults: 5 }],
    ["12.10", { firstResult: 12, maxResults: 13 }],
  ])("starts the cursor %s at its run with the rows it skips", async (after, window) => {
    const engine = engineOf("5a 4b 3c 3d 3e 2f")

    await pageOf({ limit: 1, after: PageCursor(after) }, engine.read)

    expect(engine.windows[0]).toStrictEqual(window)
  })
})
