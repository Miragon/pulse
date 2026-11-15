import { toEngineDate, type IncidentScope } from "@miragon/pulse-c7-core"
import { definitionRefOfInstance } from "@miragon/pulse-c7-core/runtime"
import {
  InstanceId,
  type InstanceFilter,
  type InstanceSummary,
  type IsoTimestamp,
  type Page,
  type PageRequest,
  type VariableComparison,
  type VariableCondition,
} from "@miragon/pulse-engine-core"
import {
  LosslessJson,
  Present,
  type EngineClient,
  type HistoricInstanceQuery,
  type HistoricInstanceView,
  type VariableQueryCondition,
} from "../engine-rest/index.js"
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

export class InstanceSearch {
  constructor(private readonly client: EngineClient) {}

  async search(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    const scoped = await this.scopedToIncidents(filter)
    if (scoped.instanceIds?.length === 0) {
      return { items: [] }
    }
    const paging = new OffsetPaging(page)
    const rows = await this.client.historicInstances(
      this.queryOf(scoped),
      this.windowFor(paging, scoped),
    )
    const withOpenIncident = await this.idsWithOpenIncident(rows.slice(0, page.limit), filter)
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .map((row) => this.summaryOf(row, withOpenIncident.has(row.id)))
        .filter((summary) => filter.withIncident !== false || !summary.hasIncident),
    )
  }

  async count(filter: InstanceFilter): Promise<number> {
    if (filter.withIncident === false) {
      const [counted, withIncident] = await Promise.all([
        this.historyCount(filter),
        this.count({ ...filter, withIncident: true }),
      ])
      return counted - withIncident
    }
    if (filter.withIncident === true && this.runtimeCounts(filter)) {
      return this.client.countWithIncident(this.scopeOf(filter))
    }
    return this.historyCount(await this.scopedToIncidents(filter))
  }

  private historyCount(filter: InstanceFilter): Promise<number> {
    return filter.instanceIds?.length === 0
      ? Promise.resolve(0)
      : this.client.historicInstanceCount(this.queryOf(filter))
  }

  private async scopedToIncidents(filter: InstanceFilter): Promise<InstanceFilter> {
    if (filter.withIncident !== true || filter.instanceIds?.length === 0) {
      return filter
    }
    if (filter.lifecycle === "ended") {
      return { ...filter, instanceIds: [] }
    }
    const failing = await this.client.instancesWithIncident(this.scopeOf(filter))
    const wanted =
      filter.instanceIds === undefined ? undefined : new Set<string>(filter.instanceIds)
    return {
      ...filter,
      instanceIds: failing
        .filter((instance) => wanted?.has(instance.id) ?? true)
        .map((instance) => InstanceId(instance.id)),
    }
  }

  private runtimeCounts(filter: InstanceFilter): boolean {
    return (
      filter.lifecycle !== "ended" &&
      filter.instanceIds === undefined &&
      filter.activeElementId === undefined &&
      (filter.variables?.length ?? 0) === 0
    )
  }

  private scopeOf(filter: InstanceFilter): IncidentScope {
    return Present.fields({
      processDefinitionId: filter.definitionId,
      processDefinitionKey: filter.bpmnProcessId,
      businessKey: filter.businessKey,
    })
  }

  private queryOf(filter: InstanceFilter): HistoricInstanceQuery {
    return Present.fields({
      processDefinitionId: filter.definitionId,
      processDefinitionKey: filter.bpmnProcessId,
      processInstanceIds: filter.instanceIds,
      processInstanceBusinessKey: filter.businessKey,
      unfinished: filter.lifecycle === "running" ? (true as const) : undefined,
      finished: filter.lifecycle === "ended" ? (true as const) : undefined,
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
    return toEngineDate(new Date(at))
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
      definition: definitionRefOfInstance(row),
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
    if (filter.withIncident === true) {
      return new Set(rows.map((row) => row.id))
    }
    return this.client.withIncidentAmong(
      rows.filter((row) => row.endTime === undefined).map((row) => row.id),
    )
  }
}
