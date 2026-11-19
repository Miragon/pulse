/**
 * The instances of an engine (`searchInstances` and `countInstances` of the engine contract): the
 * history's rows, newest first, paged by offset, each flagged when the runtime holds an open
 * incident for it. "With incident" is the runtime's (`with-incident.ts`): a search with it pages
 * the history's rows of the runtime's ids in the filter's scope, a count asks the runtime alone
 * when it knows the whole filter, and "without" is all minus those with one. A search without
 * drops the rows the runtime flags and fills its page from further windows (`filling-pages.ts`),
 * flagging every running row of each window.
 */

import {
  InstanceId,
  type InstanceFilter,
  type InstanceSummary,
  type Page,
  type PageRequest,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { countWithIncident, instancesWithIncident, withIncidentAmong } from "../with-incident.js"
import { FillingPages } from "./filling-pages.js"
import {
  countHistoricInstances,
  type HistoricInstanceRow,
  instanceSummaryOf,
  readHistoricInstances,
} from "./historic-instances.js"
import { historicQueryOf, incidentScopeOf, runtimeKnowsWhole } from "./instance-query.js"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"

/** The rows of `window` to ask for: never more than the ids the filter names. */
function cappedFor(window: OffsetWindow, filter: InstanceFilter): OffsetWindow {
  const most = filter.instanceIds?.length
  return most === undefined ? window : { ...window, maxResults: Math.min(window.maxResults, most) }
}

/** The ids of the rows that still run, the only ones the runtime can hold an incident for. */
function runningIdsOf(rows: readonly HistoricInstanceRow[]): string[] {
  return rows.filter((row) => row.endTime === undefined).map((row) => row.id)
}

/** Searches and counts the instances of an engine over its port. */
export class InstanceSearch {
  constructor(private readonly port: EnginePort) {}

  /** A page of the instances `filter` finds, newest first. */
  async search(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    const scoped = await this.scopedToIncidents(filter)
    if (scoped.instanceIds?.length === 0) {
      return { items: [] }
    }
    if (filter.withIncident === false) {
      return this.withoutIncident(scoped, page)
    }
    const paging = new OffsetPaging(page)
    const rows = await readHistoricInstances(
      this.port,
      historicQueryOf(scoped),
      cappedFor(paging.window(), scoped),
    )
    const withOpenIncident = await this.idsWithOpenIncident(rows.slice(0, page.limit), filter)
    return paging.pageOf(rows, (pageRows) =>
      pageRows.map((row) => instanceSummaryOf(row, withOpenIncident.has(row.id))),
    )
  }

  /** How many instances `filter` finds. */
  async count(filter: InstanceFilter): Promise<number> {
    if (filter.withIncident === false) {
      const [counted, withIncident] = await Promise.all([
        this.historyCount(filter),
        this.count({ ...filter, withIncident: true }),
      ])
      return counted - withIncident
    }
    if (filter.withIncident === true && runtimeKnowsWhole(filter)) {
      return countWithIncident(this.port, incidentScopeOf(filter))
    }
    return this.historyCount(await this.scopedToIncidents(filter))
  }

  private historyCount(filter: InstanceFilter): Promise<number> {
    return filter.instanceIds?.length === 0
      ? Promise.resolve(0)
      : countHistoricInstances(this.port, historicQueryOf(filter))
  }

  private async scopedToIncidents(filter: InstanceFilter): Promise<InstanceFilter> {
    if (filter.withIncident !== true || filter.instanceIds?.length === 0) {
      return filter
    }
    if (filter.lifecycle === "ended") {
      return { ...filter, instanceIds: [] }
    }
    const failing = await instancesWithIncident(this.port, incidentScopeOf(filter))
    const wanted =
      filter.instanceIds === undefined ? undefined : new Set<string>(filter.instanceIds)
    return {
      ...filter,
      instanceIds: failing
        .filter((instance) => wanted?.has(instance.id) ?? true)
        .map((instance) => InstanceId(instance.id)),
    }
  }

  /** A full page of the instances without an open incident: the rows the runtime flags drop. */
  private withoutIncident(
    filter: InstanceFilter,
    page: PageRequest,
  ): Promise<Page<InstanceSummary>> {
    const query = historicQueryOf(filter)
    return new FillingPages(page).pageOf(async (window) => {
      const rows = await readHistoricInstances(this.port, query, cappedFor(window, filter))
      const failing = await withIncidentAmong(this.port, runningIdsOf(rows))
      return rows.map((row) => (failing.has(row.id) ? undefined : instanceSummaryOf(row, false)))
    })
  }

  private async idsWithOpenIncident(
    rows: readonly HistoricInstanceRow[],
    filter: InstanceFilter,
  ): Promise<ReadonlySet<string>> {
    if (filter.withIncident === true) {
      return new Set(rows.map((row) => row.id))
    }
    return withIncidentAmong(this.port, runningIdsOf(rows))
  }
}
