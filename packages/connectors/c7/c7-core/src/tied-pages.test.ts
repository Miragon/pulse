import { PageCursor, type PageRequest } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { OffsetWindow } from "./port.js"
import { turnTies } from "./testing/fake-port.js"
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
    const turn = options.turning === true ? windows.length : 0
    windows.push(window)
    const answer = turnTies(rows, (row) => row.key, turn)
    return Promise.resolve(answer.slice(window.firstResult, window.firstResult + window.maxResults))
  }
  return { windows, read }
}

/** `count` rows of `key` in a scrambled order, as `engineOf` writes them: ids `aa`, `ab` … */
function tiedRun(key: string, count: number): string[] {
  const letter = (code: number) => String.fromCharCode(97 + code)
  return Array.from({ length: count }, (_, index) => {
    const at = (index * 7919) % count
    return `${key}${letter(Math.floor(at / 26))}${letter(at % 26)}`
  })
}

/** `count` rows raised at once between a newer row a and an older row z. */
const runOf = (count: number) => ["9a", ...tiedRun("5", count), "1z"].join(" ")

/** 600 rows raised at once, more than a window of 500 holds, between a newer row and an older. */
const LONG_RUN = runOf(600)

/** The ids of `written`'s rows in the engine's order. */
const idsOf = (written: string) => written.split(" ").map((row) => row.slice(1))

const pageOf = (page: PageRequest, read: ReturnType<typeof engineOf>["read"]) =>
  new TiedPages(page).pageOf(read)

/** `count` runs of 500 rows the page drops, each with a key of its own, then a kept row a. */
const droppedRuns = (count: number) =>
  [
    ...Array.from({ length: count }, (_, run) => String(99 - run)).flatMap((key) =>
      tiedRun(key, 500).map((row) => row.toUpperCase()),
    ),
    "1a",
  ].join(" ")

/** Every page from the first on: its items each, and how many requests it sent. */
async function walkOf(engine: ReturnType<typeof engineOf>, limit: number) {
  const pages: string[][] = []
  const requests: number[] = []
  let after: PageCursor | undefined
  do {
    const before = engine.windows.length
    const page = await pageOf(after === undefined ? { limit } : { limit, after }, engine.read)
    pages.push([...page.items])
    requests.push(engine.windows.length - before)
    after = page.next
  } while (after !== undefined && pages.length < 50)
  return { pages, requests }
}

const walk = async (engine: ReturnType<typeof engineOf>, limit: number) =>
  (await walkOf(engine, limit)).pages

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

  it("keeps the engine's order at plain offsets for a run that fills a window of 500 rows", async () => {
    const dropped = Array<string>(501).fill("1X")
    const engine = engineOf(["1b", "1a", ...dropped, "0c"].join(" "))

    const page = await pageOf({ limit: 2 }, engine.read)

    // No window holds the run of 503 whole, as the one row after the window of 500 tells, so its
    // rows are not ordered by id; the next window starts where the one of 500 ended.
    expect(page).toStrictEqual({ items: ["b", "a"], next: PageCursor("503") })
    expect(engine.windows.map(({ maxResults }) => maxResults)).toStrictEqual([
      4, 8, 16, 32, 64, 128, 256, 500, 1, 500,
    ])
    expect(engine.windows.slice(-2).map(({ firstResult }) => firstResult)).toStrictEqual([500, 500])
  })

  it("reads a run of exactly 500 rows whole, as the row after its window tells, so it pages without gaps or repeats where the engine turns it on every request", async () => {
    const written = runOf(500)
    const engine = engineOf(written, { turning: true })

    const items = (await walk(engine, 50)).flat()

    expect(items).toStrictEqual(["a", ...idsOf(written).slice(1, -1).sort(), "z"])
    expect(engine.windows.slice(4, 6)).toStrictEqual([
      { firstResult: 1, maxResults: 500 },
      { firstResult: 501, maxResults: 1 },
    ])
    expect(Math.max(...engine.windows.map(({ maxResults }) => maxResults))).toBe(500)
  })

  it("reads a run of exactly 500 rows whole where no row follows its window", async () => {
    const written = tiedRun("5", 500).join(" ")
    const engine = engineOf(written)

    const page = await pageOf({ limit: 2 }, engine.read)

    expect(page).toStrictEqual({
      items: idsOf(written).sort().slice(0, 2),
      next: PageCursor("0.2"),
    })
    expect(engine.windows.slice(-2)).toStrictEqual([
      { firstResult: 0, maxResults: 500 },
      { firstResult: 500, maxResults: 1 },
    ])
  })

  it("reads the run after one of exactly 500 rows whole, ordered by id", async () => {
    const written = ["9a", ...tiedRun("5", 500), "1z", "1y"].join(" ")
    const engine = engineOf(written)
    const last = idsOf(written).slice(1, -2).sort().at(-1)

    const page = await pageOf({ limit: 2, after: PageCursor("1.499") }, engine.read)

    expect(page).toStrictEqual({ items: [last, "y"], next: PageCursor("501.1") })
    expect(engine.windows).toStrictEqual([
      { firstResult: 1, maxResults: 500 },
      { firstResult: 501, maxResults: 1 },
      { firstResult: 501, maxResults: 500 },
    ])
  })

  it("keeps a run of 501 rows at plain offsets, its cursor saying so, since the row after its window of 500 goes on it", async () => {
    const written = runOf(501)
    const engine = engineOf(written)

    const page = await pageOf({ limit: 50 }, engine.read)

    expect(page).toStrictEqual({ items: idsOf(written).slice(0, 50), next: PageCursor("50~") })
    expect(engine.windows.slice(-2)).toStrictEqual([
      { firstResult: 1, maxResults: 500 },
      { firstResult: 501, maxResults: 1 },
    ])
  })

  it("reads the page and two rows more from a cursor into a run of more than 500 rows, in one window", async () => {
    const engine = engineOf(LONG_RUN)
    const ids = idsOf(LONG_RUN)

    const page = await pageOf({ limit: 50, after: PageCursor("100~") }, engine.read)

    expect(page).toStrictEqual({ items: ids.slice(100, 150), next: PageCursor("150~") })
    expect(engine.windows).toStrictEqual([{ firstResult: 100, maxResults: 52 }])
  })

  it("reads each page after the first of a run of 1200 rows in one window, never doubling again", async () => {
    const { requests } = await walkOf(engineOf(runOf(1200)), 50)

    // The first page doubles its windows to 500 rows and reads the row after them; each later page
    // reads its rows at their plain offsets.
    expect(requests).toStrictEqual([6, ...Array<number>(24).fill(1)])
  })

  it("reads the runs after a run of more than 500 rows ends within a window from the last one's start", async () => {
    const engine = engineOf("5a 5X 5X 3d 3c 2f 2e 1g")

    const page = await pageOf({ limit: 2, after: PageCursor("1~") }, engine.read)

    expect(page).toStrictEqual({ items: ["c", "d"], next: PageCursor("5") })
    expect(engine.windows).toStrictEqual([
      { firstResult: 1, maxResults: 4 },
      { firstResult: 3, maxResults: 8 },
    ])
  })

  it("orders the run after one of more than 500 rows by id, where that run ended with a window", async () => {
    // From the cursor windows of 3, 6 … 384 rows reach the long run's end at offset 766.
    const dropped = Array<string>(765).fill("5X")
    const engine = engineOf(["5b", "5a", ...dropped, "3d", "3c", "1e"].join(" "))

    const page = await pageOf({ limit: 1, after: PageCursor("2~") }, engine.read)

    expect(page).toStrictEqual({ items: ["c"], next: PageCursor("767.1") })
    expect(engine.windows).toHaveLength(9)
    expect(engine.windows.at(-1)).toStrictEqual({ firstResult: 767, maxResults: 500 })
  })

  it("pages a run of 600 tied rows each once where the engine keeps their order", async () => {
    const engine = engineOf(LONG_RUN)

    const items = (await walk(engine, 50)).flat()

    expect(items).toHaveLength(602)
    expect(new Set(items).size).toBe(602)
    expect([items[0], items.at(-1)]).toStrictEqual(["a", "z"])
    expect(Math.max(...engine.windows.map(({ maxResults }) => maxResults))).toBe(500)
  })

  it("reads each offset of a run of 600 once, in windows of at most 500, where the engine turns it on every request", async () => {
    const engine = engineOf(LONG_RUN, { turning: true })

    const pages = await walk(engine, 50)

    // Of a run no window holds whole rows may repeat and others be missed, never one around it.
    expect(pages.map((page) => page.length)).toStrictEqual([...Array<number>(12).fill(50), 2])
    const items = pages.flat()
    expect(items.filter((item) => item.length === 1)).toStrictEqual(["a", "z"])
    expect([items[0], items.at(-1)]).toStrictEqual(["a", "z"])
    expect(Math.max(...engine.windows.map(({ maxResults }) => maxResults))).toBe(500)
  })

  it.each([
    ["1.450", { firstResult: 1, maxResults: 500 }],
    ["0.9007199254740990", { firstResult: 0, maxResults: 500 }],
  ])("cuts the first window of the cursor %s to 500 rows", async (after, window) => {
    const engine = engineOf(LONG_RUN)

    await pageOf({ limit: 100, after: PageCursor(after) }, engine.read)

    expect(engine.windows[0]).toStrictEqual(window)
  })

  it("counts a cursor's skip in plain offsets where its run is longer than 500 rows", async () => {
    const engine = engineOf(LONG_RUN)
    const ids = idsOf(LONG_RUN)

    const page = await pageOf({ limit: 2, after: PageCursor("1.450") }, engine.read)

    expect(page).toStrictEqual({ items: ids.slice(451, 453), next: PageCursor("453~") })
  })

  it("skips in plain offsets past the window of 500 rows where the cursor's skip reaches beyond it", async () => {
    const engine = engineOf(LONG_RUN)
    const ids = idsOf(LONG_RUN)

    const page = await pageOf({ limit: 2, after: PageCursor("1.550") }, engine.read)

    expect(page).toStrictEqual({ items: ids.slice(551, 553), next: PageCursor("553~") })
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

  it.each(["5", "5~"])(
    "gives an empty last page for the cursor %s past the last row",
    async (after) => {
      const engine = engineOf("1a")

      expect(await pageOf({ limit: 1, after: PageCursor(after) }, engine.read)).toStrictEqual({
        items: [],
      })
    },
  )

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

  it.each([
    [1, [...Array<number>(12).fill(10), 1]],
    [50, [10, 10, 10, 10, 1]],
    [100, [10, 10, 10, 10]],
    [498, [10, 10, 5]],
  ])(
    "sends at most 10 requests a page at limit %i, the one-row reads counted, and reaches the kept row after twelve dropped runs of 500 rows",
    async (limit, sent) => {
      const engine = engineOf(droppedRuns(12))

      const { pages, requests } = await walkOf(engine, limit)

      expect(pages.flat()).toStrictEqual(["a"])
      expect(requests).toStrictEqual(sent)
    },
  )

  it("ends a page before a run that fills a window of 500 rows where no request is left for the row after it", async () => {
    const engine = engineOf(["200b", droppedRuns(4)].join(" "))

    const page = await pageOf({ limit: 100 }, engine.read)

    // The tenth request reads the fourth run, but none is left to tell it from a longer run, so the
    // page keeps what it took before and the next page reads that run again.
    expect(page).toStrictEqual({ items: ["b"], next: PageCursor("1501") })
    expect(
      engine.windows.map(({ firstResult, maxResults }) => [firstResult, maxResults]),
    ).toStrictEqual([
      [0, 102],
      [1, 204],
      [1, 408],
      [1, 500],
      [501, 1],
      [501, 500],
      [1001, 1],
      [1001, 500],
      [1501, 1],
      [1501, 500],
    ])
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
    "~",
    "~1",
    "1~~",
    "1.~",
    "1.2~",
    "9007199254740992~",
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
    ["3~", { firstResult: 3, maxResults: 3 }],
  ])("starts the cursor %s at its run with the rows it skips", async (after, window) => {
    const engine = engineOf("5a 4b 3c 3d 3e 2f")

    await pageOf({ limit: 1, after: PageCursor(after) }, engine.read)

    expect(engine.windows[0]).toStrictEqual(window)
  })
})
