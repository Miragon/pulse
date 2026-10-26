import {
  ElementId,
  IsoTimestamp,
  type DefinitionId,
  type InstanceFilter,
  type InstanceId,
  type InstanceSummary,
  type Page,
  type PageCursor,
  type ProcessRuntime,
  type VariableComparison,
  type VariableCondition,
} from "../../contract/index.js"
import {
  VariableConditionRules,
  type InstanceListFilter,
  type InstanceScope,
  type ScopeCounts,
  type VariableConditionView,
  type VariableValueType,
} from "../protocol/index.js"

const PAGE_SIZE = 50

type ComparisonOf = (name: string, operator: VariableComparison, value: string) => VariableCondition

const VALUE_CONDITIONS: Readonly<Record<VariableValueType, ComparisonOf>> = {
  text: (name, operator, value) => ({ name, operator, valueJson: JSON.stringify(value) }),
  number: (name, operator, value) => ({ name, operator, valueJson: value }),
  boolean: (name, operator, value) => ({ name, operator, valueJson: value }),
  date: (name, operator, value) => ({ name, operator, at: IsoTimestamp(value) }),
  null: (name, operator) => ({ name, operator, valueJson: "null" }),
}
const ID_PAGE_SIZE = 250

const SCOPES: Readonly<
  Record<InstanceListFilter["scope"], Pick<InstanceFilter, "lifecycle" | "withIncident">>
> = {
  running: { lifecycle: "running" },
  withIncident: { lifecycle: "running", withIncident: true },
  ended: { lifecycle: "ended" },
  all: {},
}

export class InstanceListQuery {
  constructor(private readonly runtime: ProcessRuntime) {}

  page(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    after?: PageCursor,
  ): Promise<Page<InstanceSummary>> {
    return this.runtime.searchInstances(this.instanceFilter(definitionId, filter), {
      limit: PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    })
  }

  async counts(definitionId: DefinitionId, filter: InstanceListFilter): Promise<ScopeCounts> {
    const [running, withIncident, ended] = await Promise.all([
      this.count(definitionId, filter, "running"),
      this.count(definitionId, filter, "withIncident"),
      this.count(definitionId, filter, "ended"),
    ])
    return { running, withIncident, ended, all: running + ended }
  }

  async liveCounts(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    shown: ScopeCounts,
    withHistory: boolean,
  ): Promise<ScopeCounts> {
    const [running, withIncident, ended] = await Promise.all([
      this.count(definitionId, filter, "running"),
      this.count(definitionId, filter, "withIncident"),
      withHistory ? this.count(definitionId, filter, "ended") : Promise.resolve(shown.ended),
    ])
    return { running, withIncident, ended, all: running + ended }
  }

  async idsMatching(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    narrowed: (filter: InstanceFilter) => InstanceFilter,
    most: number,
  ): Promise<InstanceId[]> {
    const query = narrowed(this.instanceFilter(definitionId, filter))
    const ids: InstanceId[] = []
    let after: PageCursor | undefined
    do {
      const page = await this.runtime.searchInstances(query, {
        limit: ID_PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      })
      ids.push(...page.items.map((instance) => instance.id))
      after = page.next
    } while (after !== undefined && ids.length <= most)
    return ids
  }

  private count(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    scope: InstanceScope,
  ): Promise<number> {
    return this.runtime.countInstances(this.instanceFilter(definitionId, { ...filter, scope }))
  }

  private instanceFilter(definitionId: DefinitionId, filter: InstanceListFilter): InstanceFilter {
    return {
      definitionId,
      ...SCOPES[filter.scope],
      ...(filter.elementId === undefined ? {} : { activeElementId: ElementId(filter.elementId) }),
      ...(filter.businessKey === undefined ? {} : { businessKey: filter.businessKey }),
      ...(filter.variables === undefined
        ? {}
        : { variables: filter.variables.map((condition) => this.variableCondition(condition)) }),
    }
  }

  private variableCondition(condition: VariableConditionView): VariableCondition {
    const { name, operator, value } = condition
    if (operator === "like") {
      return { name, operator, pattern: value }
    }
    return VALUE_CONDITIONS[VariableConditionRules.typeOf(condition)](name, operator, value)
  }
}
