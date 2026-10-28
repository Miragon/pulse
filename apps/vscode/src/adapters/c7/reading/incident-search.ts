import {
  ElementId,
  IncidentId,
  InstanceId,
  type DefinitionRef,
  type Incident,
  type IncidentFilter,
  type Page,
  type PageRequest,
} from "../../../contract/index.js"
import { RootIncident } from "../mapping/root-incident.js"
import { Timestamps } from "../mapping/timestamps.js"
import { Present, type EngineClient, type IncidentView } from "../engine-rest/index.js"
import type { DefinitionReader } from "./definition-reader.js"
import { OffsetPaging } from "./offset-paging.js"

const WORK_INCIDENT_TYPES: ReadonlySet<string> = new Set(["failedJob", "failedExternalTask"])

export class IncidentSearch {
  constructor(
    private readonly client: EngineClient,
    private readonly definitions: DefinitionReader,
  ) {}

  async search(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    const paging = new OffsetPaging(page)
    const query = Present.fields({
      processDefinitionId: filter.definitionId,
      processDefinitionKeyIn:
        filter.bpmnProcessId === undefined ? undefined : [filter.bpmnProcessId],
      processInstanceId: filter.instanceId,
    })
    const [rows, definitionsById] = await Promise.all([
      this.client.incidents(query, paging.window()),
      this.definitions.refsById(),
    ])
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .filter((row) => RootIncident.is(row))
        .flatMap((row) => this.incidentOf(row, definitionsById.get(row.processDefinitionId ?? ""))),
    )
  }

  private incidentOf(row: IncidentView, definition: DefinitionRef | undefined): Incident[] {
    if (row.processInstanceId === undefined || definition === undefined) {
      return []
    }
    const job =
      row.configuration !== undefined && WORK_INCIDENT_TYPES.has(row.incidentType)
        ? { id: row.configuration }
        : undefined
    return [
      {
        id: IncidentId(row.id),
        instanceId: InstanceId(row.processInstanceId),
        definition,
        elementId: ElementId(row.activityId),
        type: row.incidentType,
        message: row.incidentMessage ?? "",
        createdAt: Timestamps.fromEngine(row.incidentTimestamp),
        ...Present.fields({ job }),
      },
    ]
  }
}
