import type { InstanceFilter, InstanceSummary, Page, PageRequest } from "../../../contract/index.js"
import type { HistoricFacts } from "../mapping/historic-summary-mapper.js"
import type { Mapper } from "../mapping/mapper.js"
import type {
  HistoricInstanceQuery,
  HistoricInstanceView,
  EngineClient,
} from "../engine-rest/index.js"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"

export interface InstanceSearchMappers {
  readonly queries: Mapper<InstanceFilter, HistoricInstanceQuery>
  readonly summaries: Mapper<HistoricFacts, InstanceSummary>
}

export class InstanceSearch {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: InstanceSearchMappers,
  ) {}

  async search(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    if (filter.instanceIds?.length === 0) {
      return { items: [] }
    }
    const paging = new OffsetPaging(page)
    const rows = await this.client.historicInstances(
      this.mappers.queries.map(filter),
      this.windowFor(paging, filter),
    )
    const withOpenIncident = await this.idsWithOpenIncident(rows.slice(0, page.limit), filter)
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .map((row) =>
          this.mappers.summaries.map({ row, hasIncident: withOpenIncident.has(row.id) }),
        )
        .filter((summary) => filter.withIncident !== false || !summary.hasIncident),
    )
  }

  async count(filter: InstanceFilter): Promise<number> {
    if (filter.instanceIds?.length === 0) {
      return 0
    }
    const counted = await this.client.historicInstanceCount(this.mappers.queries.map(filter))
    if (filter.withIncident !== false) {
      return counted
    }
    const withIncident = await this.client.historicInstanceCount(
      this.mappers.queries.map({ ...filter, withIncident: true }),
    )
    return counted - withIncident
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
