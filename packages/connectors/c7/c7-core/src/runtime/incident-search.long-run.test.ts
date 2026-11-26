import { describe, expect, it } from "vitest"
import { type FakePort, turningTies } from "../testing/fake-port.js"
import {
  incidentsOf,
  pagesOf,
  ROOT,
  rootIncident,
  searchOver,
  secondsBefore,
} from "../testing/incident-search.test-support.js"

/**
 * 600 root incidents raised at one instant, more than a request of 500 rows holds, in a scrambled
 * order of their ids, between a newer incident (ROOT, `inc-1`) and an older one (`inc-0`).
 */
const ROWS = [
  ROOT,
  ...Array.from({ length: 600 }, (_, index) =>
    rootIncident(`inc-t${String((index * 7919) % 600).padStart(3, "0")}`, secondsBefore(1)),
  ),
  rootIncident("inc-0", secondsBefore(2)),
]

/**
 * 250 root incidents raised at one instant and `copies` incidents copied up from them to calling
 * instances at that instant, between ROOT and an older incident: a run of 250 + `copies` rows.
 */
function rootsAndCopies(copies: number) {
  const roots = Array.from({ length: 250 }, (_, index) =>
    rootIncident(`inc-r${String((index * 7919) % 250).padStart(3, "0")}`, secondsBefore(1)),
  )
  const copied = Array.from({ length: copies }, (_, index) => ({
    ...rootIncident(`inc-c${String(index).padStart(3, "0")}`, secondsBefore(1)),
    rootCauseIncidentId: "inc-r000",
  }))
  const run = roots.flatMap((root, index) => [root, ...copied.slice(index, index + 1)])
  return {
    roots,
    rows: [ROOT, ...run, ...copied.slice(250), rootIncident("inc-0", secondsBefore(2))],
  }
}

/** The most rows one request for the incidents asked for. */
function largestWindow(port: FakePort): number {
  const asked = port.calls
    .filter((call) => call.operationId === "getIncidents")
    .map((call) => Number(call.input.query.maxResults))
  return Math.max(...asked)
}

describe("IncidentSearch.search over a run of 500 incident rows or more raised at one instant", () => {
  it("lists each incident once, in requests of at most 500 rows, where the engine keeps their order", async () => {
    const { port, search } = searchOver(incidentsOf(ROWS))

    const ids = (await pagesOf(search, 50)).flat()

    expect(ids).toHaveLength(602)
    expect(new Set(ids).size).toBe(602)
    expect([ids[0], ids.at(-1)]).toStrictEqual(["inc-1", "inc-0"])
    expect(largestWindow(port)).toBe(500)
  })

  it("reads each offset of the run once, in requests of at most 500 rows, where the engine turns it on every request", async () => {
    const { port, search } = searchOver(turningTies(ROWS, (row) => row.incidentTimestamp))

    const pages = await pagesOf(search, 50)

    // Of the run incidents may repeat and others be missed, never one raised before or after it.
    expect(pages.map((page) => page.length)).toStrictEqual([...Array<number>(12).fill(50), 2])
    const ids = pages.flat()
    expect(ids.filter((id) => !id.startsWith("inc-t"))).toStrictEqual(["inc-1", "inc-0"])
    expect([ids[0], ids.at(-1)]).toStrictEqual(["inc-1", "inc-0"])
    expect(largestWindow(port)).toBe(500)
  })

  it("reads 250 root incidents and 250 copies raised at one instant whole, a run of 500 rows, where the engine turns it on every request", async () => {
    const { roots, rows } = rootsAndCopies(250)
    const { port, search } = searchOver(turningTies(rows, (row) => row.incidentTimestamp))

    const ids = (await pagesOf(search, 50)).flat()

    expect(ids).toStrictEqual(["inc-1", ...roots.map(({ id }) => id).sort(), "inc-0"])
    expect(largestWindow(port)).toBe(500)
  })

  it("keeps 250 root incidents at their plain offsets where one copy more makes their run 501 rows", async () => {
    const { roots, rows } = rootsAndCopies(251)
    const { search } = searchOver(incidentsOf(rows))

    const page = await search.search({}, { limit: 50 })

    // The copies count in the run: its roots come in the engine's order, not by id.
    expect(page.items.map(({ id }) => id)).toStrictEqual([
      "inc-1",
      ...roots.slice(0, 49).map(({ id }) => id),
    ])
    expect(page.next).toBe("99~")
  })
})
