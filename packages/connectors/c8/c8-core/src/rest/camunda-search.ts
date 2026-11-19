import type { CamundaTransport } from "../port/camunda-transport.js"
import { JsonObject } from "./json-object.js"
import { MissingResources } from "./missing-resources.js"
import { Present } from "./present.js"
import type { Rows, SearchFilter, SearchPage, Window } from "./views.js"

type Parse<Item> = (json: JsonObject) => Item

const PAGE_SIZE = 500
const MOST_ROWS = 10_000
const MOST_KEYS = 1_000

export class CamundaSearch {
  constructor(private readonly http: CamundaTransport) {}

  async page<Item>(
    path: string,
    query: SearchFilter,
    window: Window,
    parse: Parse<Item>,
  ): Promise<SearchPage<Item>> {
    const answer = await this.http.post(path, {
      ...query,
      page: { limit: window.limit, ...Present.fields({ after: window.after }) },
    })
    const page = JsonObject.of(answer, path).object("page")
    return {
      items: JsonObject.itemsOf(answer, path).map(parse),
      total: page.requiredNumber("totalItems"),
      capped: page.flag("hasMoreTotalItems"),
      ...Present.fields({ endCursor: page.optionalString("endCursor") }),
    }
  }

  async allAfter<Item>(
    path: string,
    query: SearchFilter,
    parse: Parse<Item>,
  ): Promise<readonly Item[]> {
    return (await this.rowsAfter(path, query, parse)).items
  }

  async rowsAfter<Item>(
    path: string,
    query: SearchFilter,
    parse: Parse<Item>,
  ): Promise<Rows<Item>> {
    const items: Item[] = []
    let after: string | undefined
    for (;;) {
      const room = MOST_ROWS - items.length
      const limit = room > PAGE_SIZE ? PAGE_SIZE : room + 1
      const page = await this.page(path, query, { limit, ...Present.fields({ after }) }, parse)
      items.push(...page.items.slice(0, room))
      if (page.items.length > room) {
        return { items, cut: true }
      }
      if (page.items.length < limit || page.endCursor === undefined) {
        return { items, cut: false }
      }
      after = page.endCursor
    }
  }

  async inChunks<Item>(
    keys: readonly string[],
    read: (chunk: readonly string[]) => Promise<Rows<Item>>,
  ): Promise<Rows<Item>> {
    const chunks = Array.from({ length: Math.ceil(keys.length / MOST_KEYS) }, (_, index) =>
      keys.slice(index * MOST_KEYS, (index + 1) * MOST_KEYS),
    )
    const rows = await Promise.all(chunks.map((chunk) => read(chunk)))
    return { items: rows.flatMap((row) => row.items), cut: rows.some((row) => row.cut) }
  }

  async allFrom<Item>(
    path: string,
    query: SearchFilter,
    parse: Parse<Item>,
  ): Promise<readonly Item[]> {
    const items: Item[] = []
    for (;;) {
      const answer = await this.http.post(path, {
        ...query,
        page: { from: items.length, limit: PAGE_SIZE },
      })
      const rows = JsonObject.itemsOf(answer, path).map(parse)
      items.push(...rows)
      if (rows.length < PAGE_SIZE || items.length >= MOST_ROWS) {
        return items
      }
    }
  }

  async unlessMissing<Result>(read: () => Promise<Result>): Promise<Result | undefined> {
    try {
      return await read()
    } catch (error: unknown) {
      if (MissingResources.named(this.http.failure(error))) {
        return undefined
      }
      throw error
    }
  }
}
