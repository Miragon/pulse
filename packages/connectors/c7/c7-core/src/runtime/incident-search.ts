/**
 * The open incidents of an engine (`searchIncidents` of the engine contract): the runtime's
 * incidents newest first, paged by offset, root incidents only (one copied up from a called
 * instance is its caller's view of the same failure), each with the version it was raised in from
 * one read of the definition statistics, never one call per incident, and the job or external task
 * `incidentRecovery` names. An id of the filter no engine assigns fails as `misconfigured`.
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
import type { EnginePort } from "../port.js"
import { queryInput } from "../requests.js"
import { compact } from "../util.js"
import type { DefinitionReader } from "./definition-reader.js"
import { engineIdOf } from "./engine-ids.js"
import { type IncidentRow, incidentRowsOf, isRootIncident, recoveryIdOf } from "./incident-rows.js"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"
import { timestampOf } from "./timestamps.js"

/** The newest incident first, as the engine pages them. */
const NEWEST_FIRST = { sortBy: "incidentTimestamp", sortOrder: "desc" } as const

function optionalEngineId(value: string | undefined): string | undefined {
  return value === undefined ? undefined : engineIdOf(value)
}

/** `row` as the contract's incident; none without its instance or a version the engine lists. */
function incidentsOf(row: IncidentRow, definition: DefinitionRef | undefined): Incident[] {
  if (row.processInstanceId === undefined || definition === undefined) {
    return []
  }
  const jobId = recoveryIdOf(row)
  return [
    {
      id: IncidentId(row.id),
      instanceId: InstanceId(row.processInstanceId),
      definition,
      elementId: ElementId(row.activityId),
      type: row.incidentType,
      message: row.incidentMessage ?? "",
      createdAt: timestampOf(row.incidentTimestamp),
      ...compact({ job: jobId === undefined ? undefined : { id: jobId } }),
    },
  ]
}

/** Searches the open incidents of an engine over its port. */
export class IncidentSearch {
  constructor(
    private readonly port: EnginePort,
    private readonly definitions: DefinitionReader,
  ) {}

  /** A page of the root incidents `filter` finds, newest first. */
  async search(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    const paging = new OffsetPaging(page)
    const [rows, definitionsById] = await Promise.all([
      this.rows(filter, paging.window()),
      this.definitions.refsById(),
    ])
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .filter((row) => isRootIncident(row))
        .flatMap((row) => incidentsOf(row, definitionsById.get(row.processDefinitionId ?? ""))),
    )
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
