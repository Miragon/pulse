/**
 * The open incidents of an engine (`searchIncidents` of the engine contract): the runtime's
 * incidents newest first, paged by offset, root incidents only (one copied up from a called
 * instance is its caller's view of the same failure), each with the version it was raised in, read
 * by the ids of the versions a window's incidents name, each once per search (`refsOf`), never one
 * call per incident nor the statistics of the whole engine, the element of the diagram
 * it was raised at (a multi-instance body's on the activity it repeats, `elementOfActivity`) and
 * the job or external task `incidentRecovery` names. An incident outside any process (a failed job
 * of a batch or of the history cleanup, without element or instance) is no incident of the
 * contract: the engine-wide search passes over it and never fails on it. An id of the filter no
 * engine assigns fails as `misconfigured`. The
 * engine orders by `incidentTimestamp` alone, its one sort key, so incidents raised at the same
 * instant come in any order. A page reads every run of up to 500 such rows whole and orders it by
 * id (`TiedPages`, `src/tied-pages.ts`), so the order is newest first and then by id on every read
 * and across pages; a run counts every row the filter matches at that instant, the copies and the
 * other rows the page drops included. A longer run keeps the engine's order at plain offsets, all
 * but a rest of up to 500 rows after a page's bound, which the next page reads whole and by id.
 * Where the database orders a longer run anew between two requests, its incidents may repeat and
 * about as many be missed, even within one page. A page keeps what becomes an incident of the
 * contract and fills from further windows.
 */

import {
  type DefinitionRef,
  ElementId,
  type Incident,
  type IncidentFilter,
  IncidentId,
  InstanceId,
  type Page,
  type PageRequest,
} from "@miragon/pulse-engine-core"
import { elementOfActivity } from "../multi-instance-body.js"
import type { EnginePort } from "../port.js"
import { compareText } from "../records.js"
import { queryInput } from "../requests.js"
import { isRootIncident } from "../root-incident.js"
import { NEWEST_FIRST, tiedIncident } from "../status-incidents.js"
import { compact } from "../util.js"
import type { DefinitionReader } from "./definition-reader.js"
import { engineIdOf } from "./engine-ids.js"
import { type IncidentRow, incidentRowsOf, recoveryIdOf } from "./incident-rows.js"
import type { OffsetWindow } from "./offset-paging.js"
import { TiedPages } from "../tied-pages.js"
import { timestampOf } from "./timestamps.js"

function optionalEngineId(value: string | undefined): string | undefined {
  return value === undefined ? undefined : engineIdOf(value)
}

/**
 * The version `row` names where it can be an incident of the contract: none for an incident copied
 * up from a called instance or without its element or instance (one outside any process).
 */
function versionIdOf(row: IncidentRow): string | undefined {
  const placed = isRootIncident(row) && row.activityId !== undefined
  return placed && row.processInstanceId !== undefined ? row.processDefinitionId : undefined
}

/**
 * `row` as the contract's incident: none for an incident copied up from a called instance, without
 * its element or instance (one outside any process) or of a version the engine does not list.
 */
function incidentOf(
  row: IncidentRow,
  definitionsById: ReadonlyMap<string, DefinitionRef>,
): Incident | undefined {
  const { activityId, processInstanceId } = row
  const versionId = versionIdOf(row)
  const definition = versionId === undefined ? undefined : definitionsById.get(versionId)
  if (activityId === undefined || processInstanceId === undefined || definition === undefined) {
    return undefined
  }
  const jobId = recoveryIdOf(row)
  return {
    id: IncidentId(row.id),
    instanceId: InstanceId(processInstanceId),
    definition,
    elementId: ElementId(elementOfActivity(activityId)),
    type: row.incidentType,
    message: row.incidentMessage ?? "",
    createdAt: timestampOf(row.incidentTimestamp),
    ...compact({ job: jobId === undefined ? undefined : { id: jobId } }),
  }
}

/** The newer incident first; incidents raised at once keep their order, by id (`TiedPages`). */
function newerFirst(left: Incident, right: Incident): number {
  return compareText(right.createdAt, left.createdAt)
}

/** The versions a search's incidents name, each read once per search, by its id. */
class SearchedVersions {
  private readonly known = new Map<string, DefinitionRef>()
  private readonly asked = new Set<string>()

  constructor(private readonly definitions: DefinitionReader) {}

  /** The versions `rows` name, by their ids: those of earlier windows kept, the others read. */
  async of(rows: readonly IncidentRow[]): Promise<ReadonlyMap<string, DefinitionRef>> {
    const ids = rows.flatMap((row) => versionIdOf(row) ?? [])
    const unread = [...new Set(ids)].filter((id) => !this.asked.has(id))
    if (unread.length === 0) return this.known
    for (const id of unread) this.asked.add(id)
    for (const [id, ref] of await this.definitions.refsOf(unread)) this.known.set(id, ref)
    return this.known
  }
}

/** Searches the open incidents of an engine over its port. */
export class IncidentSearch {
  constructor(
    private readonly port: EnginePort,
    private readonly definitions: DefinitionReader,
  ) {}

  /** A page of the root incidents `filter` finds, newest first. */
  async search(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    const versions = new SearchedVersions(this.definitions)
    const found = await new TiedPages(page).pageOf(async (window) => {
      const rows = await this.rows(filter, window)
      const definitionsById = await versions.of(rows)
      return rows.map((row) => tiedIncident(row, incidentOf(row, definitionsById)))
    })
    return { ...found, items: [...found.items].sort(newerFirst) }
  }

  private async rows(filter: IncidentFilter, window: OffsetWindow): Promise<IncidentRow[]> {
    const query = {
      processDefinitionId: optionalEngineId(filter.definitionId),
      processDefinitionKeyIn: optionalEngineId(filter.bpmnProcessId),
      processInstanceId: optionalEngineId(filter.instanceId),
      ...NEWEST_FIRST,
      firstResult: String(window.firstResult),
      maxResults: String(window.maxResults),
    }
    return incidentRowsOf(await this.port.json("getIncidents", queryInput(query)))
  }
}
