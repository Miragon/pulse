/**
 * The fixtures of `IncidentSearch`'s tests: two versions the engine lists by their ids, a root
 * incident of the first, a search over a fake port that answers its incidents by a route, and the
 * pages a search lists one after the other. Under src/testing, which the mutation run leaves out,
 * but no part of the ./testing entry: `files` keeps every `*.test-support.*` out of the tarball.
 */

import type { PageCursor } from "@miragon/pulse-engine-core"
import { fakePort, type Route } from "./fake-port.js"
import { DefinitionReader } from "../runtime/definition-reader.js"
import { IncidentSearch } from "../runtime/incident-search.js"

export const ORDER_1 = { id: "order:1:a", key: "order", version: 1, name: "Order" }
export const LABEL_1 = { id: "label:1:b", key: "label", version: 1 }

export const ROOT = {
  id: "inc-1",
  incidentType: "failedJob",
  activityId: "Activity_Charge",
  incidentTimestamp: "2026-10-21T18:44:04.554+0000",
  processInstanceId: "p1",
  processDefinitionId: ORDER_1.id,
  incidentMessage: "boom",
  rootCauseIncidentId: "inc-1",
  configuration: "job-1",
}

/** The versions of `definitions` a definitions read names by their ids. */
function definitionsByIds(definitions: readonly { readonly id: string }[]): Route {
  return ({ query }) => {
    const ids = (query.processDefinitionIdIn ?? "").split(",")
    return definitions.filter((definition) => ids.includes(definition.id))
  }
}

/** A search over a port that answers the incidents by `incidents`, both versions by their ids. */
export function searchOver(incidents: Route) {
  const port = fakePort({
    getIncidents: incidents,
    getProcessDefinitions: definitionsByIds([ORDER_1, LABEL_1]),
  })
  return { port, search: new IncidentSearch(port, new DefinitionReader(port)) }
}

/** The incidents of the window a request asks for, in the order given. */
export function incidentsOf(rows: readonly object[]): Route {
  return (input) => {
    const first = Number(input.query.firstResult)
    return rows.slice(first, first + Number(input.query.maxResults))
  }
}

export function rootIncident(id: string, incidentTimestamp = ROOT.incidentTimestamp) {
  return { ...ROOT, id, rootCauseIncidentId: id, incidentTimestamp }
}

/** The timestamp `seconds` before ROOT's, so rows of distinct seconds never tie. */
export function secondsBefore(seconds: number): string {
  const instant = new Date(Date.parse(ROOT.incidentTimestamp) - seconds * 1000)
  return instant.toISOString().replace("Z", "+0000")
}

export function idsOf(page: { readonly items: readonly { readonly id: string }[] }): string[] {
  return page.items.map((incident) => incident.id)
}

/** The ids of every page `search` lists without a filter from the first on, at most 50 pages. */
export async function pagesOf(search: IncidentSearch, limit: number): Promise<string[][]> {
  const pages: string[][] = []
  let after: PageCursor | undefined
  do {
    const page = await search.search({}, after === undefined ? { limit } : { limit, after })
    pages.push(idsOf(page))
    after = page.next
  } while (after !== undefined && pages.length < 50)
  return pages
}
