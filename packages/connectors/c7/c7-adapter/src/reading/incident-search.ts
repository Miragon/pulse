import {
  ElementId,
  IncidentId,
  InstanceId,
  type DefinitionRef,
  type Incident,
  type IncidentFilter,
  type Page,
  type PageRequest,
} from "@miragon/pulse-engine-core"
import {
  isRootIncident,
  type DefinitionReader,
  type IncidentRow,
} from "@miragon/pulse-c7-core/runtime"
import { Timestamps } from "../mapping/timestamps.js"
import { Present, RecoveryTargets, type EngineClient } from "../engine-rest/index.js"
import { OffsetPaging } from "./offset-paging.js"

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
        .filter((row) => isRootIncident(row))
        .flatMap((row) => this.incidentOf(row, definitionsById.get(row.processDefinitionId ?? ""))),
    )
  }

  private incidentOf(row: IncidentRow, definition: DefinitionRef | undefined): Incident[] {
    if (row.processInstanceId === undefined || definition === undefined) {
      return []
    }
    const target = RecoveryTargets.of(row)
    const job = target === undefined ? undefined : { id: target.id }
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
