/**
 * The instances of an engine (`searchInstances` and `countInstances` of the engine contract): the
 * history's rows, newest first, paged by offset, each flagged when the runtime holds an open
 * incident for it. "With incident" is the runtime's (`with-incident.ts`): a search with it pages
 * the history's rows of the runtime's ids in the filter's scope, and a count asks the runtime alone
 * when it knows the whole filter. A search without drops the rows the runtime flags and fills its
 * page from further windows (`filling-pages.ts`), flagging every running row of each window; its
 * count is the history's count of the filter minus the history's count of the runtime's ids with
 * one, so it counts what the search lists, never below 0 (`withoutIncidentCount`). However many
 * ids the runtime holds an incident for in the scope, no request to the history carries more than
 * `chunk` of them (`history-chunks.ts`): a count sums the chunks' counts, a page merges their rows.
 * An instance id no engine assigns is dropped before anything is sent (`engineIdsOnly`), as
 * Camunda 8's keys are.
 */

import {
  InstanceId,
  type InstanceFilter,
  type InstanceSummary,
  type Page,
  type PageRequest,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { isEngineId } from "./engine-ids.js"
import { countWithIncident, instancesWithIncident, withIncidentAmong } from "../with-incident.js"
import { FillingPages } from "./filling-pages.js"
import { HISTORY_ID_CHUNK } from "./history-chunks.js"
import {
  countHistoricInstances,
  type HistoricInstanceRow,
  instanceSummaryOf,
  readHistoricInstances,
} from "./historic-instances.js"
import { historicQueryOf, incidentScopeOf, runtimeKnowsWhole } from "./instance-query.js"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"
import { versionTenantsOf } from "./version-tenants.js"

/**
 * The filter with only the instance ids an engine could have assigned (`isEngineId`): any other
 * names no instance, so it is never sent, and a filter left with none finds nothing without a
 * request (what a reader types into a search, say, which may be a business key).
 */
function engineIdsOnly(filter: InstanceFilter): InstanceFilter {
  const { instanceIds } = filter
  return instanceIds === undefined
    ? filter
    : { ...filter, instanceIds: instanceIds.filter((id) => isEngineId(id)) }
}

/** The rows of `window` to ask for: never more than the ids the filter names. */
function cappedFor(window: OffsetWindow, filter: InstanceFilter): OffsetWindow {
  const most = filter.instanceIds?.length
  return most === undefined ? window : { ...window, maxResults: Math.min(window.maxResults, most) }
}

/** The ids of the rows that still run, the only ones the runtime can hold an incident for. */
function runningIdsOf(rows: readonly HistoricInstanceRow[]): string[] {
  return rows.filter((row) => row.endTime === undefined).map((row) => row.id)
}

/**
 * Searches and counts the instances of an engine over its port, at most `chunk` instance ids per
 * request to the history.
 */
export class InstanceSearch {
  constructor(
    private readonly port: EnginePort,
    private readonly chunk = HISTORY_ID_CHUNK,
  ) {}

  /** A page of the instances `filter` finds, newest first. */
  async search(wanted: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    const filter = engineIdsOnly(wanted)
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
      this.chunk,
    )
    const shown = rows.slice(0, page.limit)
    const [withOpenIncident, tenants] = await Promise.all([
      this.idsWithOpenIncident(shown, filter),
      versionTenantsOf(this.port, shown),
    ])
    return paging.pageOf(rows, (pageRows) =>
      pageRows.map((row) => instanceSummaryOf(row, withOpenIncident.has(row.id), tenants)),
    )
  }

  /** How many instances `filter` finds. */
  async count(wanted: InstanceFilter): Promise<number> {
    const filter = engineIdsOnly(wanted)
    if (filter.withIncident === false) {
      return this.withoutIncidentCount(filter)
    }
    if (filter.withIncident === true && runtimeKnowsWhole(filter)) {
      return countWithIncident(this.port, incidentScopeOf(filter))
    }
    return this.historyCount(await this.scopedToIncidents(filter))
  }

  /**
   * The instances of `filter` without an open incident, as the search lists them: the history's
   * instances of the filter minus those of them the runtime holds an open incident for, which the
   * history counts over the runtime's ids in the filter's scope. Never the runtime's own count of
   * those: a history that misses instances the runtime runs (history level NONE keeps none, a level
   * raised from it, a cleanup by removal time at start) counts none of them, so subtracting them
   * would count too few, below 0 at NONE. Both counts read the history, the second over a subset
   * of the first's instances, so it is never the larger unless an instance starts or ends between
   * the two reads; then the count is 0, never below.
   */
  private async withoutIncidentCount(filter: InstanceFilter): Promise<number> {
    const [counted, withIncident] = await Promise.all([
      this.historyCount(filter),
      this.scopedToIncidents({ ...filter, withIncident: true }).then((scoped) =>
        this.historyCount(scoped),
      ),
    ])
    return Math.max(0, counted - withIncident)
  }

  private historyCount(filter: InstanceFilter): Promise<number> {
    return filter.instanceIds?.length === 0
      ? Promise.resolve(0)
      : countHistoricInstances(this.port, historicQueryOf(filter), this.chunk)
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
      const rows = await readHistoricInstances(
        this.port,
        query,
        cappedFor(window, filter),
        this.chunk,
      )
      const [failing, tenants] = await Promise.all([
        withIncidentAmong(this.port, runningIdsOf(rows)),
        versionTenantsOf(this.port, rows),
      ])
      return rows.map((row) =>
        failing.has(row.id) ? undefined : instanceSummaryOf(row, false, tenants),
      )
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
