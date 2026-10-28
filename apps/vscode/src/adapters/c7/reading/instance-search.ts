import {
  InstanceId,
  type InstanceFilter,
  type InstanceSummary,
  type IsoTimestamp,
  type Page,
  type PageRequest,
  type VariableComparison,
  type VariableCondition,
} from "../../../contract/index.js"
import {
  LosslessJson,
  Present,
  type EngineClient,
  type HistoricInstanceQuery,
  type HistoricInstanceView,
  type VariableQueryCondition,
} from "../engine-rest/index.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import { InstanceStates } from "../mapping/instance-states.js"
import { Timestamps } from "../mapping/timestamps.js"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"

const OPERATORS: Readonly<Record<VariableComparison, VariableQueryCondition["operator"]>> = {
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  lessThan: "lt",
}
const SQL_WILDCARDS = /[\\%_]/g
const ENGINE_UTC_OFFSET = "+0000"

export class InstanceSearch {
  constructor(private readonly client: EngineClient) {}

  async search(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    if (filter.instanceIds?.length === 0) {
      return { items: [] }
    }
    const paging = new OffsetPaging(page)
    const rows = await this.client.historicInstances(
      this.queryOf(filter),
      this.windowFor(paging, filter),
    )
    const withOpenIncident = await this.idsWithOpenIncident(rows.slice(0, page.limit), filter)
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .map((row) => this.summaryOf(row, withOpenIncident.has(row.id)))
        .filter((summary) => filter.withIncident !== false || !summary.hasIncident),
    )
  }

  async count(filter: InstanceFilter): Promise<number> {
    if (filter.instanceIds?.length === 0) {
      return 0
    }
    const counted = await this.client.historicInstanceCount(this.queryOf(filter))
    if (filter.withIncident !== false) {
      return counted
    }
    const withIncident = await this.client.historicInstanceCount(
      this.queryOf({ ...filter, withIncident: true }),
    )
    return counted - withIncident
  }

  private queryOf(filter: InstanceFilter): HistoricInstanceQuery {
    return Present.fields({
      processDefinitionId: filter.definitionId,
      processDefinitionKey: filter.bpmnProcessId,
      processInstanceIds: filter.instanceIds,
      processInstanceBusinessKey: filter.businessKey,
      unfinished: filter.lifecycle === "running" ? (true as const) : undefined,
      finished: filter.lifecycle === "ended" ? (true as const) : undefined,
      incidentStatus: filter.withIncident === true ? ("open" as const) : undefined,
      activityIdIn: filter.activeElementId === undefined ? undefined : [filter.activeElementId],
      variables: filter.variables?.map((condition) => this.conditionOf(condition)),
    })
  }

  private conditionOf(condition: VariableCondition): VariableQueryCondition {
    if (condition.operator === "like") {
      return { name: condition.name, operator: "like", value: this.likeOf(condition.pattern) }
    }
    return {
      name: condition.name,
      operator: OPERATORS[condition.operator],
      value:
        "at" in condition ? this.dateOf(condition.at) : LosslessJson.parse(condition.valueJson),
    }
  }

  private dateOf(at: IsoTimestamp): string {
    return new Date(at).toISOString().replace("Z", ENGINE_UTC_OFFSET)
  }

  private likeOf(pattern: string): string {
    return pattern
      .split("*")
      .map((part) => part.replace(SQL_WILDCARDS, "\\$&"))
      .join("%")
  }

  private summaryOf(row: HistoricInstanceView, hasIncident: boolean): InstanceSummary {
    return {
      id: InstanceId(row.id),
      definition: DefinitionRefs.ofInstance(row),
      state: InstanceStates.of(row.state),
      hasIncident,
      ...Present.fields({
        businessKey: row.businessKey,
        startedAt: Timestamps.optional(row.startTime),
        endedAt: Timestamps.optional(row.endTime),
        parentInstanceId:
          row.superProcessInstanceId === undefined
            ? undefined
            : InstanceId(row.superProcessInstanceId),
      }),
    }
  }

  private windowFor(paging: OffsetPaging, filter: InstanceFilter): OffsetWindow {
    const window = paging.window()
    const most = filter.instanceIds?.length
    return most === undefined || window.maxResults <= most
      ? window
      : { ...window, maxResults: most }
  }

  private async idsWithOpenIncident(
    rows: readonly HistoricInstanceView[],
    filter: InstanceFilter,
  ): Promise<ReadonlySet<string>> {
    const ids = rows.map((row) => row.id)
    if (filter.withIncident === true || ids.length === 0) {
      return new Set(filter.withIncident === true ? ids : [])
    }
    const flagged = await this.client.historicInstances(
      { processInstanceIds: ids, incidentStatus: "open" },
      { firstResult: 0, maxResults: ids.length },
    )
    return new Set(flagged.map((row) => row.id))
  }
}
