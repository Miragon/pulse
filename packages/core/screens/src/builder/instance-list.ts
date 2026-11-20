import type { DefinitionId, InstanceSummary, Page, PageCursor } from "@miragon/pulse-engine-core"
import type { InstanceListFilterData } from "../format/instance-list-data.js"
import { InstanceCounts } from "./instance-counts.js"
import type {
  InstanceListFacts,
  InstanceListModel,
  InstanceListReads,
  InstanceListRequest,
  InstancePageReads,
} from "./instance-list-model.js"
import { InstanceQuery } from "./instance-query.js"

export class InstanceList {
  static readonly PAGE_SIZE = 50

  static async read(
    engine: string,
    request: InstanceListRequest,
    reads: InstanceListReads,
    now: () => Date,
  ): Promise<InstanceListModel> {
    const asOf = now()
    const { definitionId, filter, after } = request
    const [page, counts] = await Promise.all([
      InstanceList.page(reads, definitionId, filter, after),
      after === undefined ? InstanceCounts.read(reads, definitionId, filter) : undefined,
    ])
    return InstanceList.of({
      engine,
      asOf,
      definitionId,
      page,
      counts,
      refusedVariableConditions: reads.refusedVariableConditions?.() ?? [],
    })
  }

  static page(
    reads: InstancePageReads,
    definitionId: DefinitionId,
    filter: InstanceListFilterData,
    after?: PageCursor,
  ): Promise<Page<InstanceSummary>> {
    return reads.searchInstances(InstanceQuery.of(definitionId, filter), {
      limit: InstanceList.PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    })
  }

  static of(facts: InstanceListFacts): InstanceListModel {
    return {
      engine: facts.engine,
      asOf: facts.asOf,
      definitionId: facts.definitionId,
      rows: facts.page.items,
      next: facts.page.next,
      counts: facts.counts,
      refusedVariableConditions: facts.refusedVariableConditions,
    }
  }
}
