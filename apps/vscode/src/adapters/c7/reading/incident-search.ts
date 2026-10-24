import type { Incident, IncidentFilter, Page, PageRequest } from "../../../contract/index.js"
import type { IncidentRowFacts } from "../mapping/incident-row-mapper.js"
import type { Mapper } from "../mapping/mapper.js"
import { RootIncident } from "../mapping/root-incident.js"
import type { IncidentQuery, EngineClient } from "../engine-cli/index.js"
import type { DefinitionReader } from "./definition-reader.js"
import { OffsetPaging } from "./offset-paging.js"

export interface IncidentSearchMappers {
  readonly queries: Mapper<IncidentFilter, IncidentQuery>
  readonly rows: Mapper<IncidentRowFacts, Incident | undefined>
}

export class IncidentSearch {
  constructor(
    private readonly client: EngineClient,
    private readonly definitions: DefinitionReader,
    private readonly mappers: IncidentSearchMappers,
  ) {}

  async search(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    const paging = new OffsetPaging(page)
    const [rows, definitionsById] = await Promise.all([
      this.client.incidents(this.mappers.queries.map(filter), paging.window()),
      this.definitions.refsById(),
    ])
    return paging.pageOf(rows, (pageRows) =>
      pageRows
        .filter((row) => RootIncident.is(row))
        .flatMap((row) => this.mappers.rows.map({ row, definitionsById }) ?? []),
    )
  }
}
