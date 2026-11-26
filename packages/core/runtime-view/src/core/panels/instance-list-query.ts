import {
  IsoTimestamp,
  type DefinitionId,
  type InstanceFilter,
  type InstanceId,
  type InstanceSummary,
  type Page,
  type PageCursor,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { InstanceCounts, InstanceList, InstanceQuery } from "@miragon/pulse-screens/builder"
import {
  VariableConditionRules,
  type InstanceListFilter,
  type ScopeCounts,
  type VariableConditionView,
} from "../protocol/index.js"

const ID_PAGE_SIZE = 250

export class InstanceListQuery {
  constructor(private readonly runtime: ProcessRuntime) {}

  page(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    after?: PageCursor,
  ): Promise<Page<InstanceSummary>> {
    return InstanceList.page(this.runtime, definitionId, InstanceListQuery.zoned(filter), after)
  }

  counts(definitionId: DefinitionId, filter: InstanceListFilter): Promise<ScopeCounts> {
    return InstanceCounts.read(this.runtime, definitionId, InstanceListQuery.zoned(filter))
  }

  liveCounts(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    shown: ScopeCounts,
    withHistory: boolean,
  ): Promise<ScopeCounts> {
    const ended = withHistory ? undefined : InstanceCounts.endedOf(shown)
    return InstanceCounts.read(this.runtime, definitionId, InstanceListQuery.zoned(filter), ended)
  }

  async idsMatching(
    definitionId: DefinitionId,
    filter: InstanceListFilter,
    narrowed: (filter: InstanceFilter) => InstanceFilter,
    most: number,
  ): Promise<InstanceId[]> {
    const query = narrowed(InstanceQuery.of(definitionId, InstanceListQuery.zoned(filter)))
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

  private static zoned(filter: InstanceListFilter): InstanceListFilter {
    const { variables } = filter
    return variables === undefined
      ? filter
      : {
          ...filter,
          variables: variables.map((condition) => InstanceListQuery.instantOf(condition)),
        }
  }

  private static instantOf(condition: VariableConditionView): VariableConditionView {
    return VariableConditionRules.typeOf(condition) === "date"
      ? { ...condition, value: IsoTimestamp(condition.value) }
      : condition
  }
}
