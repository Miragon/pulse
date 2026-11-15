import { describe, expect, test } from "vitest"
import {
  IsoTimestamp,
  PageCursor,
  type Incident,
  type IncidentFilter,
  type InstanceFilter,
  type Page,
  type PageRequest,
  type ProcessRuntime,
} from "../src/index.js"
import { CASE, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

const EVERY = { limit: 1000 }
const NEWEST = Date.parse("2026-01-01T00:00:00.000Z")
const SECOND_MS = 1000

interface EngineRow {
  readonly incident: Incident
  readonly propagatedCopy: boolean
}

function withoutIncidentFilter(filter: InstanceFilter): InstanceFilter {
  const { withIncident, ...rest } = filter
  return withIncident === undefined ? filter : rest
}

function offsetPage<Item>(rows: readonly Item[], page: PageRequest, slack = 0): Page<Item> {
  const offset = page.after === undefined ? 0 : Number(page.after)
  const end = rows.length - offset <= page.limit + slack ? rows.length : offset + page.limit
  const items = rows.slice(offset, end)
  return end < rows.length ? { items, next: PageCursor(String(end)) } : { items }
}

async function everyIncident(
  runtime: ProcessRuntime,
  filter: IncidentFilter,
): Promise<readonly Incident[]> {
  return (await runtime.searchIncidents(filter, EVERY)).items
}

async function copiesDroppedAfterThePage(
  runtime: ProcessRuntime,
  filter: IncidentFilter,
  page: PageRequest,
): Promise<Page<Incident>> {
  const rows: EngineRow[] = (await everyIncident(runtime, filter)).flatMap((incident) => [
    { incident, propagatedCopy: true },
    { incident, propagatedCopy: false },
  ])
  const found = offsetPage(rows, page)
  const items = found.items.filter((row) => !row.propagatedCopy).map((row) => row.incident)
  return { ...found, items }
}

async function oldestFirstInPagesOfOne(
  runtime: ProcessRuntime,
  filter: IncidentFilter,
  page: PageRequest,
): Promise<Page<Incident>> {
  const timed = (await everyIncident(runtime, filter)).map((incident, index) => ({
    ...incident,
    createdAt: IsoTimestamp(new Date(NEWEST - index * SECOND_MS).toISOString()),
  }))
  return offsetPage(page.limit === 1 ? [...timed].reverse() : timed, page)
}

function instancesFilteredAfterThePage(withIncident: boolean): Sabotage {
  return (runtime) => ({
    searchInstances: async (filter, page) => {
      if (filter.withIncident !== withIncident) {
        return runtime.searchInstances(filter, page)
      }
      const found = await runtime.searchInstances(withoutIncidentFilter(filter), page)
      return { ...found, items: found.items.filter((item) => item.hasIncident === withIncident) }
    },
  })
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "the oldest incidents come first",
    (runtime) => ({
      searchIncidents: async (filter, page) => {
        const found = await runtime.searchIncidents(filter, page)
        return {
          ...found,
          items: [...found.items].reverse().map((incident, index) => ({
            ...incident,
            createdAt: IsoTimestamp(`2026-01-01T00:00:0${String(index)}.000Z`),
          })),
        }
      },
    }),
    [CASE.incidentsNewestFirst],
  ],
  [
    "each read returns the incidents in another order",
    (runtime) => {
      let reads = 0
      return {
        searchIncidents: async (filter, page) => {
          const found = await runtime.searchIncidents(filter, page)
          reads += 1
          return reads % 2 === 0 ? { ...found, items: [...found.items].reverse() } : found
        },
      }
    },
    [CASE.incidentsNewestFirst],
  ],
  [
    "pages of one list the oldest incident first",
    (runtime) => ({
      searchIncidents: (filter, page) => oldestFirstInPagesOfOne(runtime, filter, page),
    }),
    [CASE.incidentsNewestFirst],
  ],
  [
    "instances without an incident are filtered after the page",
    instancesFilteredAfterThePage(false),
    [CASE.instancesPagesFull],
  ],
  [
    "instances with an incident are filtered after the page",
    instancesFilteredAfterThePage(true),
    [CASE.instancesPagesFull],
  ],
  [
    "propagated copies of incidents are dropped after the page",
    (runtime) => ({
      searchIncidents: (filter, page) => copiesDroppedAfterThePage(runtime, filter, page),
    }),
    [CASE.incidentsPaging],
  ],
  [
    "the incident page cursor is ignored",
    (runtime) => ({
      searchIncidents: (filter, page) => runtime.searchIncidents(filter, { limit: page.limit }),
    }),
    [CASE.incidentsPaging],
  ],
  [
    "the last page of incidents holds one more than its limit",
    (runtime) => ({
      searchIncidents: async (filter, page) =>
        offsetPage(await everyIncident(runtime, filter), page, 1),
    }),
    [CASE.incidentsPaging],
  ],
]

describe("the order and page laws", () => {
  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
      [...expected].sort(),
    )
  })
})
