import { BpmnProcessId, ElementId, type InstanceId, type PageCursor } from "../../../model/ids.js"
import type { InstanceFilter } from "../../../model/queries.js"
import type { InstanceSummary } from "../../../model/read-models.js"
import type { ConformanceHarness } from "../harness.js"
import { VariableSearch } from "./variable-laws.js"
import { WORLD_ELEMENT, WORLD_PROCESS, type InstanceAlias } from "../world/world.js"

const PAGE_LIMIT = 50
export const MAX_PAGES = 10
const ORDER = BpmnProcessId(WORLD_PROCESS.order)

export class InstanceReads {
  static async search(
    harness: ConformanceHarness,
    filter: InstanceFilter,
  ): Promise<readonly InstanceSummary[]> {
    const page = await harness.runtime.searchInstances(filter, { limit: PAGE_LIMIT })
    return page.items
  }

  static async searchAll(
    harness: ConformanceHarness,
    filter: InstanceFilter,
  ): Promise<readonly InstanceSummary[]> {
    const found: InstanceSummary[] = []
    let after: PageCursor | undefined
    for (let pages = 1; pages <= MAX_PAGES; pages += 1) {
      const page = await harness.runtime.searchInstances(filter, {
        limit: PAGE_LIMIT,
        ...(after === undefined ? {} : { after }),
      })
      found.push(...page.items)
      if (page.next === undefined) {
        break
      }
      after = page.next
    }
    return found
  }

  static idsOf(harness: ConformanceHarness, aliases: readonly InstanceAlias[]): InstanceId[] {
    return aliases.map((alias) => harness.world.instanceIds[alias])
  }

  static countedFilters(harness: ConformanceHarness): readonly InstanceFilter[] {
    const orderV1 = harness.world.definitionIds["order@1"]
    return [
      { definitionId: orderV1 },
      { definitionId: orderV1, lifecycle: "running" },
      { definitionId: orderV1, lifecycle: "running", withIncident: true },
      { definitionId: orderV1, lifecycle: "ended" },
      { bpmnProcessId: ORDER, lifecycle: "running", withIncident: false },
      {
        bpmnProcessId: ORDER,
        lifecycle: "running",
        activeElementId: ElementId(WORLD_ELEMENT.reviewOrder),
      },
      { definitionId: orderV1, businessKey: "ORD-1003" },
      { definitionId: harness.world.unknown.definitionId },
      ...VariableSearch.countedFilters(harness),
    ]
  }
}
