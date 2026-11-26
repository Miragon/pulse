import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { compareText, compareTime } from "../records.js"
import type { HistoricInstanceQuery } from "./historic-instances.js"
import {
  chunkedQueries,
  HISTORY_ID_CHUNK,
  mergedNewestFirst,
  NEWEST_FIRST,
} from "./history-chunks.js"

interface Row {
  readonly id: string
  readonly startTime?: string
}

function startedAt(id: string, second: number): Row {
  return { id, startTime: `2026-10-21T18:44:${String(second).padStart(2, "0")}.000+0000` }
}

/** A row the history lists, at one of 31 seconds or, rarely as the history has none, without. */
const started = fc
  .record({
    id: fc.stringMatching(/^p[0-9a-f]{1,3}$/),
    second: fc.option(fc.integer({ min: 0, max: 30 }), { freq: 8 }),
  })
  .map(({ id, second }): Row => (second === null ? { id } : startedAt(id, second)))

function idsOf(rows: readonly Row[]): string[] {
  return rows.map((row) => row.id)
}

/** The history's order, written out once more for the properties. */
function historyOrder(left: Row, right: Row): number {
  return compareTime(right.startTime, left.startTime) || compareText(left.id, right.id)
}

describe("chunkedQueries", () => {
  it("leaves a query alone that names no ids, or no more than a chunk holds", () => {
    const query: HistoricInstanceQuery = { processDefinitionKey: "order" }
    const atTheBound = { processInstanceIds: ["p1", "p2", "p2"] }

    expect(chunkedQueries(query, 2)).toStrictEqual([query])
    expect(chunkedQueries(query, 2)[0]).toBe(query)
    expect(chunkedQueries(atTheBound, 3)[0]).toBe(atTheBound)
    expect(chunkedQueries({ processInstanceIds: [] }, 1)).toStrictEqual([
      { processInstanceIds: [] },
    ])
  })

  it("splits the ids in their order into chunks, each with the rest of the query", () => {
    const query = { unfinished: true, processInstanceIds: ["p5", "p1", "p4", "p2", "p3"] } as const

    expect(chunkedQueries(query, 2)).toStrictEqual([
      { unfinished: true, processInstanceIds: ["p5", "p1"] },
      { unfinished: true, processInstanceIds: ["p4", "p2"] },
      { unfinished: true, processInstanceIds: ["p3"] },
    ])
    expect(chunkedQueries(query, 1).map((part) => part.processInstanceIds)).toStrictEqual([
      ["p5"],
      ["p1"],
      ["p4"],
      ["p2"],
      ["p3"],
    ])
    expect(query.processInstanceIds).toHaveLength(5)
  })

  it("sends a repeated id once, so no instance is in two chunks", () => {
    const repeated = { processInstanceIds: ["p1", "p2", "p1", "p3", "p2"] }

    expect(chunkedQueries(repeated, 2)).toStrictEqual([
      { processInstanceIds: ["p1", "p2"] },
      { processInstanceIds: ["p3"] },
    ])
    expect(chunkedQueries(repeated, 4)).toStrictEqual([{ processInstanceIds: ["p1", "p2", "p3"] }])
  })

  it("carries at most 500 ids per request by default", () => {
    expect(HISTORY_ID_CHUNK).toBe(500)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s ids per request before it splits anything",
    (chunk) => {
      expect(() => chunkedQueries({ processInstanceIds: ["p1", "p2"] }, chunk)).toThrow(
        new RangeError(`${String(chunk)} instance ids per request is no chunk`),
      )
    },
  )

  it("refuses a chunk that is no whole number even for a query without ids", () => {
    expect(() => chunkedQueries({}, 0)).toThrow(RangeError)
  })
})

describe("mergedNewestFirst", () => {
  it("orders the rows of the chunks newest first, the lower id first at the same start", () => {
    const merged = mergedNewestFirst(
      [
        [startedAt("p9", 5), startedAt("p3", 2)],
        [startedAt("p10", 5), startedAt("p4", 4), startedAt("p1", 1)],
        [startedAt("p7", 3)],
      ],
      10,
    )

    expect(idsOf(merged)).toStrictEqual(["p10", "p9", "p4", "p7", "p3", "p1"])
  })

  it("compares the instants, never the text of the engine's offset", () => {
    const merged = mergedNewestFirst(
      [
        [{ id: "p1", startTime: "2026-10-21T20:44:04.000+0200" }],
        [{ id: "p2", startTime: "2026-10-21T19:44:04.000+0000" }],
        [{ id: "p0", startTime: "2026-10-21T18:44:04.000+0000" }],
      ],
      3,
    )

    expect(idsOf(merged)).toStrictEqual(["p2", "p0", "p1"])
  })

  it("keeps each chunk's rows in the order the engine sent them", () => {
    const merged = mergedNewestFirst(
      [[startedAt("b", 1), startedAt("a", 1)], [startedAt("c", 1)]],
      3,
    )

    expect(idsOf(merged)).toStrictEqual(["b", "a", "c"])
  })

  it("takes the earlier chunk's row where two rows are alike", () => {
    const first = startedAt("p1", 1)
    const second = startedAt("p1", 1)

    const [merged] = mergedNewestFirst([[first], [second]], 1)

    expect(merged).toBe(first)
  })

  it("takes the most rows asked for, fewer when the chunks hold fewer", () => {
    const chunks = [[startedAt("p1", 3), startedAt("p2", 1)], [], [startedAt("p3", 2)]]

    expect(idsOf(mergedNewestFirst(chunks, 2))).toStrictEqual(["p1", "p3"])
    expect(idsOf(mergedNewestFirst(chunks, 5))).toStrictEqual(["p1", "p3", "p2"])
    expect(mergedNewestFirst(chunks, 0)).toStrictEqual([])
    expect(mergedNewestFirst([], 5)).toStrictEqual([])
  })

  it("asks the history for its order by start, newest first, then by id", () => {
    expect(NEWEST_FIRST).toStrictEqual([
      { sortBy: "startTime", sortOrder: "desc" },
      { sortBy: "instanceId", sortOrder: "asc" },
    ])
  })

  const distinctRows = fc.uniqueArray(started, { selector: (row) => row.id, maxLength: 40 })

  it("gives the history's order of the rows of every chunk, as one query of all ids gives it", () => {
    fc.assert(
      fc.property(distinctRows, fc.integer({ min: 1, max: 7 }), (rows, size) => {
        const chunks: Row[][] = []
        for (let start = 0; start < rows.length; start += size) {
          chunks.push(rows.slice(start, start + size).sort(historyOrder))
        }
        const merged = mergedNewestFirst(chunks, rows.length)
        expect(merged).toStrictEqual([...rows].sort(historyOrder))
      }),
    )
  })

  it("begins a longer merge with a shorter one, whatever order the chunks hold", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(started, { maxLength: 6 }), { maxLength: 6 }),
        fc.nat(20),
        fc.nat(20),
        (chunks, shorter, more) => {
          const longer = mergedNewestFirst(chunks, shorter + more)
          expect(mergedNewestFirst(chunks, shorter)).toStrictEqual(longer.slice(0, shorter))
        },
      ),
    )
  })
})
