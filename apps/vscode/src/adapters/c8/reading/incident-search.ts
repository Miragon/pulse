import type { Incident, IncidentFilter, Page, PageRequest } from "../../../contract/index.js"
import { Incidents } from "../mapping/incidents.js"
import { Keys } from "../mapping/keys.js"
import { PageCursors } from "../mapping/page-cursors.js"
import { Present, type CamundaClient, type SearchFilter } from "../rest/index.js"
import type { DefinitionRefsCache } from "./definition-refs-cache.js"

export class IncidentSearch {
  constructor(
    private readonly client: CamundaClient,
    private readonly definitions: DefinitionRefsCache,
  ) {}

  async search(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    const query = IncidentSearch.queryOf(filter)
    if (query === undefined) {
      return { items: [] }
    }
    const answer = await this.client.incidents(query, PageCursors.windowOf(page.limit, page.after))
    const items = await Promise.all(
      answer.items.map(async (view) => {
        const definition = await this.definitions.of(view.definitionKey)
        return definition === undefined ? [] : [Incidents.of(view, definition)]
      }),
    )
    const seen = PageCursors.seenBefore(page.after) + answer.items.length
    const more = answer.items.length === page.limit && (answer.capped || seen < answer.total)
    return {
      items: items.flat(),
      ...(more && answer.endCursor !== undefined
        ? { next: PageCursors.next(seen, answer.endCursor) }
        : {}),
    }
  }

  private static queryOf(filter: IncidentFilter): SearchFilter | undefined {
    const keys = [filter.definitionId, filter.instanceId].filter((key) => key !== undefined)
    if (!keys.every((key) => Keys.isKey(key))) {
      return undefined
    }
    return Present.fields({
      processDefinitionId: filter.bpmnProcessId,
      processDefinitionKey: filter.definitionId,
      processInstanceKey: filter.instanceId,
    })
  }
}
