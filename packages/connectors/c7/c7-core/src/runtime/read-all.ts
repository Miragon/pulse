/**
 * Every row of a list operation, page by page and checked: an answer that is no list fails as
 * `RuntimeError("unexpectedResponse")` in words that name the operation's path, never read as a
 * shorter list (the port's `list` drops such an answer silently). The rows are the caller's to
 * read with `JsonView.listOf`, which fails a row that is no object.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { CORE_ROUTES } from "../core-routes.js"
import { type EnginePort, pageQuery, type Query } from "../port.js"

/** The rows asked for per request; a shorter page is the last one. */
export const PAGE_SIZE = 500

/** Where an operation reads, as the words of an unusable answer name it. */
function pathOf(operationId: string): string {
  return CORE_ROUTES[operationId]?.path ?? operationId
}

/**
 * Every row `operationId` lists for `query`: pages of 500 (`firstResult`, then `maxResults`,
 * after the query's own values) until a page holds fewer.
 */
export async function readAll(
  port: EnginePort,
  operationId: string,
  query: Query,
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (;;) {
    const page: unknown = await port.json(operationId, {
      pathArgs: [],
      query: pageQuery(query, rows.length, PAGE_SIZE),
    })
    if (!Array.isArray(page)) {
      throw new RuntimeError("unexpectedResponse", `${pathOf(operationId)} is not a list`)
    }
    const items: readonly unknown[] = page
    rows.push(...items)
    if (items.length < PAGE_SIZE) return rows
  }
}
