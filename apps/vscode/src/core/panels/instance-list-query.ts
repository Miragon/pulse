import {
  ElementId,
  type DefinitionId,
  type InstanceFilter,
  type InstanceId,
  type InstanceSummary,
  type Page,
  type PageCursor,
  type ProcessRuntime,
  type VariableCondition,
} from "../../contract/index.js"
import {
  VariableConditionRules,
  type InstanceListFilter,
  type InstanceScope,
  type ScopeCounts,
  type VariableConditionView,
} from "../protocol/index.js"

const PAGE_SIZE = 50
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
    const asText = VariableConditionRules.typeOf(condition) === "text"
    return { name, operator, valueJson: asText ? JSON.stringify(value) : value }
  }
}
