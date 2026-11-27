/**
 * The fixtures of an activity's page of incidents (`buildActivityIncidentsData`): the key's latest
 * diagram, what the element counts read of the version that holds the root incidents, the
 * incidents per activity id with their ties turned on every request, an engine to page, and the
 * count its group shows on the process route.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { isRootIncident } from "@miragon/pulse-c7-core"
import { turningTies } from "@miragon/pulse-c7-core/testing"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import type { ActivityIncidentsData } from "../view-models.js"
import { buildActivityIncidentsData } from "./activity-incidents-data.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"
import { at, engines, KEY, newestFirst, V2 } from "./process-incidents-data.test-support.js"

/** The key's latest version and its diagram: `assess` a service task, `callCheck` a call activity. */
export function latestDiagram(key = KEY, definitionId = V2): FakeRoutes {
  return {
    "GET /process-definition": { body: [{ id: definitionId, key, name: "Leasing", version: 2 }] },
    [`GET /process-definition/${definitionId}/xml`]: {
      body: {
        id: definitionId,
        bpmn20Xml: `<definitions><process id="${key}"><serviceTask id="assess" name="Assess creditworthiness"/><callActivity id="callCheck" name="Check applicant"/></process></definitions>`,
      },
    },
  }
}

/** The definition statistics of the key's one version `definitionId`, `roots` root incidents in it. */
const definitionStatistics = (definitionId: string, roots: number) => ({
  body: [
    {
      id: definitionId,
      instances: 0,
      incidents: [{ incidentType: "failedJob", incidentCount: roots }],
      definition: { id: definitionId, key: KEY, version: 2 },
    },
  ],
})

/** A row the fakes list: its id, its version, and the root incident it copies where it is a copy. */
interface ListedRow {
  readonly id: string
  readonly processDefinitionId: string
  readonly rootCauseIncidentId?: string | null
}

/**
 * What the element counts read of the key's one version `definitionId` that holds root incidents,
 * as the engine answers now, the lists of `byActivity` read at each request: the definition
 * statistics, the version's root incidents, and its element statistics, every incident of the
 * version at each activity, the copies too.
 */
export function liveCounts(
  definitionId: string,
  byActivity: Readonly<Record<string, readonly ListedRow[]>>,
): FakeRoutes {
  const ofVersion = (rows: readonly ListedRow[]) =>
    rows.filter((row) => row.processDefinitionId === definitionId)
  const roots = () => ofVersion(Object.values(byActivity).flat()).filter(isRootIncident).length
  return {
    "GET /process-definition/statistics": () => definitionStatistics(definitionId, roots()),
    [`GET /process-definition/${definitionId}/statistics`]: () => ({
      body: Object.entries(byActivity).map(([id, rows]) => at(id, ofVersion(rows).length)),
    }),
  }
}

/**
 * The engine's incidents at each activity id, newest first, as `/incident` and `/incident/count`
 * answer a query by one (its `activityId`): each run raised at one instant turned one place
 * further on every request, as a database may order them, then paged by `firstResult` and
 * `maxResults`; none at any other id. A query by no activity, the key's scan, lists every one of
 * them, newest first.
 */
export function turningIncidentsAt(
  byActivity: Readonly<Record<string, readonly { readonly incidentTimestamp: string }[]>>,
): FakeRoutes {
  const turning = new Map(
    Object.entries(byActivity).map(([activityId, rows]) => [
      activityId,
      turningTies(rows, (row) => row.incidentTimestamp),
    ]),
  )
  const rowsAt = (query: Readonly<Record<string, string>>) => byActivity[query.activityId ?? ""]
  return {
    "GET /incident": (r: RecordedRequest) => ({
      body:
        r.query.activityId === undefined
          ? newestFirst(byActivity).slice(0, Number(r.query.maxResults))
          : (turning.get(r.query.activityId)?.({ pathArgs: [], query: r.query }) ?? []),
    }),
    "GET /incident/count": (r: RecordedRequest) => ({
      body: { count: rowsAt(r.query)?.length ?? 0 },
    }),
  }
}

/** Which page to read: the activity, the cursor of the page before, the page's size. */
export interface ActivityTarget {
  readonly activityId: string
  readonly after?: string
  readonly maxResults?: number
  readonly processDefinitionKey?: string
}

/** An engine of `routes` (any other answers `[]`) and its activity pages, read by one client. */
export async function activityEngine(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  const client = clientFor(engine)
  const page = (target: ActivityTarget) =>
    buildActivityIncidentsData(client, {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      ...target,
    })
  return { engine, client, page }
}

/** One page of the activity on an engine of `routes`, and the requests it sent. */
export async function pageOn(routes: FakeRoutes, target: ActivityTarget) {
  const { engine, page } = await activityEngine(routes)
  return { data: await page(target), requests: engine.requests }
}

/** A page of the activity as the feed answers it. */
type ActivityPage = Omit<ActivityIncidentsData, "engineId">

/**
 * Every page from the first on, each by the `next` of the one before: the incident ids of each
 * page and the total each answered.
 */
export async function walk(
  page: (target: ActivityTarget) => Promise<ActivityPage>,
  target: ActivityTarget,
): Promise<{ ids: string[][]; totals: (number | null)[] }> {
  const pages: ActivityPage[] = []
  let after: string | null | undefined
  do {
    const data = await page(after ? { ...target, after } : target)
    pages.push(data)
    after = data.next
  } while (after !== null && pages.length < 200)
  return {
    ids: pages.map((data) => data.incidents.map((incident) => incident.id)),
    totals: pages.map((data) => data.totalCount),
  }
}

/** What the process route reads besides the incidents, the diagram and the statistics. */
export const ROUTE_COUNTS: FakeRoutes = {
  "GET /process-instance/count": { body: { count: 1 } },
  "GET /job/count": { body: { count: 0 } },
}

/** The count the group of `activityId` shows on the process route, read by `client` as it reads. */
export async function groupCountOf(
  client: Client,
  baseUrl: string,
  activityId: string,
): Promise<number | undefined> {
  const route = await buildProcessIncidentsData(client, {
    baseUrl,
    provider: cibsevenProvider,
    processDefinitionKey: KEY,
  })
  return route.activities.find((activity) => activity.activityId === activityId)?.incidentCount
}

export const queriesOf = (requests: readonly RecordedRequest[], path: string) =>
  requests.filter((r) => r.path === path).map((r) => r.query)
