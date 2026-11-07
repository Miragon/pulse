import type {
  BpmnProcessId,
  DefinitionId,
  InstanceCount,
  InstanceFilter,
  InstanceSummary,
  Page,
  PageRequest,
} from "../../../contract/index.js"
import { InstanceSummaries } from "../mapping/instance-summaries.js"
import { PageCursors } from "../mapping/page-cursors.js"
import type { CamundaClient } from "../rest/index.js"
import { InstanceFilters } from "./instance-filters.js"

interface RunningCounts {
  readonly withoutIncident: number
  readonly withIncident: number
}

export class InstanceSearch {
  constructor(private readonly client: CamundaClient) {}

  async search(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    const query = InstanceFilters.of(filter)
    if (query === undefined) {
      return { items: [] }
    }
    const answer = await this.client.instances(query, PageCursors.windowOf(page.limit, page.after))
    const seen = PageCursors.seenBefore(page.after) + answer.items.length
    const more = answer.items.length === page.limit && (answer.capped || seen < answer.total)
    return {
      items: answer.items.map((item) => InstanceSummaries.of(item)),
      ...(more && answer.endCursor !== undefined
        ? { next: PageCursors.next(seen, answer.endCursor) }
        : {}),
    }
  }

  async count(filter: InstanceFilter): Promise<InstanceCount> {
    const query = InstanceFilters.of(filter)
    if (query === undefined) {
      return { count: 0 }
    }
    const answer = await this.client.instances(query, { limit: 0 })
    if (!answer.capped) {
      return { count: answer.total }
    }
    const exact = await this.exactFromStatistics(filter)
    return exact === undefined ? { count: answer.total, atLeast: true } : { count: exact }
  }

  private async exactFromStatistics(filter: InstanceFilter): Promise<number | undefined> {
    if (!InstanceSearch.isPlainRunningCount(filter)) {
      return undefined
    }
    const rows = await this.statisticsOf(filter)
    return rows?.reduce((sum, row) => sum + InstanceSearch.runningOf(row, filter), 0)
  }

  private statisticsOf(filter: InstanceFilter): Promise<readonly RunningCounts[] | undefined> {
    if (filter.definitionId !== undefined) {
      return this.versionStatisticsOf(filter.definitionId, filter.bpmnProcessId)
    }
    return filter.bpmnProcessId === undefined
      ? this.client.processStatistics()
      : this.client.versionStatistics(filter.bpmnProcessId)
  }

  private async versionStatisticsOf(
    definitionId: DefinitionId,
    bpmnProcessId: BpmnProcessId | undefined,
  ): Promise<readonly RunningCounts[] | undefined> {
    const process = bpmnProcessId ?? (await this.client.definition(definitionId))?.bpmnProcessId
    if (process === undefined) {
      return undefined
    }
    const rows = await this.client.versionStatistics(process)
    return rows.filter((row) => row.key === definitionId)
  }

  private static runningOf(row: RunningCounts, filter: InstanceFilter): number {
    if (filter.withIncident === undefined) {
      return row.withoutIncident + row.withIncident
    }
    return filter.withIncident ? row.withIncident : row.withoutIncident
  }

  private static isPlainRunningCount(filter: InstanceFilter): boolean {
    return (
      filter.lifecycle === "running" &&
      filter.businessKey === undefined &&
      filter.activeElementId === undefined &&
      filter.instanceIds === undefined &&
      (filter.variables === undefined || filter.variables.length === 0)
    )
  }
}
