import { describe, expect, it } from "vitest"
import { engineDateMillis, engineFormat } from "./dates.js"
import type { OperationInput } from "./port.js"
import { field, type Rec } from "./records.js"
import { newestIncidents, newestIncidentsRequest } from "./status-incidents.js"
import { fakePort, type FakePort, type Route, turningTies } from "./testing/fake-port.js"
import {
  incidentsOf,
  ROOT,
  rootIncident,
  secondsBefore,
} from "./testing/incident-search.test-support.js"

const FILTER = { processDefinitionKeyIn: "order,label" }

/** A port that answers the incidents by `incidents`, and every other operation not at all. */
const engineOf = (incidents: Route) => fakePort({ getIncidents: incidents })

/** The windows the incident requests asked for, in order. */
function windowsOf(port: FakePort): { firstResult: number; maxResults: number }[] {
  return port.calls.map(({ input }) => ({
    firstResult: Number(input.query.firstResult),
    maxResults: Number(input.query.maxResults),
  }))
}

const idsOf = (items: readonly Rec[]) => items.map((item) => field(item, "id"))

type Incident = ReturnType<typeof rootIncident>

/** `count` root incidents a second apart from `seconds` before ROOT's on, newest first. */
const apart = (count: number, seconds = 0) =>
  Array.from({ length: count }, (_, index) =>
    rootIncident(`inc-${String(seconds + index).padStart(4, "0")}`, secondsBefore(seconds + index)),
  )

/** `count` incidents raised at one instant, `seconds` before ROOT's, their ids scrambled. */
const runOf = (count: number, seconds: number) =>
  Array.from({ length: count }, (_, index) =>
    rootIncident(`inc-t${String((index * 7919) % count).padStart(4, "0")}`, secondsBefore(seconds)),
  )

/** The ids of `rows` newest first and then by id, as the walk lists them. */
const orderedIds = (rows: readonly Incident[]) =>
  [...rows]
    .sort(
      (left, right) =>
        right.incidentTimestamp.localeCompare(left.incidentTimestamp) ||
        left.id.localeCompare(right.id),
    )
    .map(({ id }) => id)

/**
 * 1,300 incidents newest first in runs of 7 raised at one instant, their ids scrambled, so a run
 * falls on each offset where a window of 500 ends.
 */
const tiedRuns = () =>
  Array.from({ length: 1300 }, (_, index) =>
    rootIncident(
      `inc-${String((index * 7919) % 1300).padStart(4, "0")}`,
      secondsBefore(Math.floor(index / 7)),
    ),
  )

/**
 * A live engine over `rows`: before each request after the first, `raised` new incidents, the
 * newest, land at offset 0. Where `bounded`, a request lists only those raised strictly before its
 * `incidentTimestampBefore`, as the engines do.
 */
function liveEngine(rows: readonly Incident[], raised: number, bounded: boolean): Route {
  const open = [...rows]
  let requests = 0
  return (input) => {
    for (let index = 0; requests > 0 && index < raised; index += 1) {
      open.unshift(
        rootIncident(`inc-new-${String(requests)}-${String(index)}`, secondsBefore(-requests)),
      )
    }
    requests += 1
    const before = bounded ? engineDateMillis(input.query.incidentTimestampBefore) : null
    const listed =
      before === null
        ? open
        : open.filter((row) => Number(engineDateMillis(row.incidentTimestamp)) < before)
    return incidentsOf(listed)(input)
  }
}

/** 2,500 incidents: 300 a second apart, a run of 400 raised at one instant, 1,800 apart. */
const storm = () => [...apart(300), ...runOf(400, 300), ...apart(1800, 301)]

/** An engine that ignores the paging: every request lists all of `rows`. */
const ignoringPaging =
  (rows: readonly Incident[]): Route =>
  () =>
    rows

/** An engine that ignores the offset: every request lists the first rows it asks for. */
const ignoringOffsets =
  (rows: readonly Incident[]): Route =>
  (input) =>
    rows.slice(0, Number(input.query.maxResults))

describe("newestIncidents", () => {
  it("reads the newest incidents of a scope in one request of 500 rows where fewer are open, copies too", async () => {
    const copy = { ...rootIncident("inc-c", secondsBefore(1)), rootCauseIncidentId: "inc-r" }
    const rows = [rootIncident("inc-r"), copy, rootIncident("inc-o", secondsBefore(2))]
    const port = engineOf(incidentsOf(rows))

    const loaded = await newestIncidents(port, FILTER, 2000)

    expect(loaded).toStrictEqual({ items: rows, truncated: false })
    const sent: OperationInput[] = port.calls.map((call) => call.input)
    expect(sent).toStrictEqual([newestIncidentsRequest(FILTER).input])
    expect(sent[0]?.query).toStrictEqual({
      sortBy: "incidentTimestamp",
      sortOrder: "desc",
      ...FILTER,
      firstResult: "0",
      maxResults: "500",
    })
  })

  it("lists each incident once, newest first and then by id, no window twice, where the engine turns tied incidents on every request", async () => {
    const rows = tiedRuns()
    const port = engineOf(turningTies(rows, (row) => row.incidentTimestamp))

    const loaded = await newestIncidents(port, {}, 2000)

    expect(idsOf(loaded.items)).toStrictEqual(orderedIds(rows))
    expect(loaded.truncated).toBe(false)
    // each window from the last run of the one before, which may go on past it
    expect(windowsOf(port)).toStrictEqual([
      { firstResult: 0, maxResults: 500 },
      { firstResult: 497, maxResults: 500 },
      { firstResult: 994, maxResults: 500 },
    ])
  })

  it.each([
    [2000, false],
    [2001, true],
  ])(
    "loads the newest 2,000 of %i incidents in five windows of 500 rows, each from the last row of the one before, truncated: %s",
    async (open, truncated) => {
      const rows = apart(open)
      const port = engineOf(incidentsOf(rows))

      const loaded = await newestIncidents(port, {}, 2000)

      expect(loaded).toStrictEqual({ items: rows.slice(0, 2000), truncated })
      expect(windowsOf(port)).toStrictEqual([
        { firstResult: 0, maxResults: 500 },
        { firstResult: 499, maxResults: 500 },
        { firstResult: 998, maxResults: 500 },
        { firstResult: 1497, maxResults: 500 },
        { firstResult: 1996, maxResults: 500 },
      ])
    },
  )

  it("lists each of 600 incidents raised at one instant once where the engine keeps their order", async () => {
    const rows = [rootIncident("inc-1"), ...runOf(600, 1), rootIncident("inc-0", secondsBefore(2))]
    const port = engineOf(incidentsOf(rows))

    const loaded = await newestIncidents(port, {}, 2000)

    // A run of more than 500 rows keeps the engine's order, each row at its plain offset.
    expect(loaded).toStrictEqual({ items: rows, truncated: false })
    expect(Math.max(...windowsOf(port).map((window) => window.maxResults))).toBe(500)
  })

  it("reads the incidents raised up to the first answer's newest after the first request, so new ones shift no offset", async () => {
    const rows = storm()
    const port = engineOf(liveEngine(rows, 3, true))

    const loaded = await newestIncidents(port, {}, 2000)

    expect(idsOf(loaded.items)).toStrictEqual(orderedIds(rows).slice(0, 2000))
    expect(loaded.truncated).toBe(true)
    const pins = port.calls.map(({ input }) => input.query.incidentTimestampBefore)
    const pin = engineFormat(Date.parse(ROOT.incidentTimestamp.replace("+0000", "Z")) + 1)
    expect(pins).toStrictEqual([undefined, ...pins.slice(1).map(() => pin)])
    expect(pins.length).toBeGreaterThan(1)
  })

  it("lists an incident it holds once where incidents raised during the walk shift its offsets", async () => {
    const rows = storm()
    const port = engineOf(liveEngine(rows, 3, false))

    const loaded = await newestIncidents(port, {}, 2000)

    expect(idsOf(loaded.items)).toStrictEqual(orderedIds(rows).slice(0, 2000))
    expect(loaded.truncated).toBe(true)
  })

  it.each([
    [2500, 2000, true],
    [1300, 1300, false],
  ])(
    "ends with the whole list of an engine that ignores the paging, %i incidents, in one request",
    async (open, listed, truncated) => {
      const rows = apart(open)
      const port = engineOf(ignoringPaging(rows))

      const loaded = await newestIncidents(port, {}, 2000)

      expect(loaded).toStrictEqual({ items: rows.slice(0, listed), truncated })
      expect(port.calls).toHaveLength(1)
    },
  )

  it("ends where a page brings no incident it does not hold, and asks for no bound where the newest has no timestamp", async () => {
    const [newest, ...older] = apart(500)
    const rows = [{ ...newest!, incidentTimestamp: "" }, ...older]
    const port = engineOf(ignoringOffsets(rows))

    const loaded = await newestIncidents(port, {}, 2000)

    // every window lists the same 500 rows, its last one a run that may go on past it
    expect(loaded).toStrictEqual({ items: rows.slice(0, 499), truncated: true })
    expect(port.calls.every(({ input }) => !("incidentTimestampBefore" in input.query))).toBe(true)
  })

  it("asks for no bound at all where the first answer's newest has no timestamp, a later one's too", async () => {
    const [newest, ...older] = apart(1500)
    const port = engineOf(incidentsOf([{ ...newest!, incidentTimestamp: "" }, ...older]))

    await newestIncidents(port, {}, 2000)

    expect(port.calls.length).toBeGreaterThan(2)
    expect(port.calls.every(({ input }) => !("incidentTimestampBefore" in input.query))).toBe(true)
  })
})
