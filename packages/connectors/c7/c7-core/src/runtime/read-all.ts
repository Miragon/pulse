/**
 * Every row of a list operation, page by page and checked: an answer that is no list fails as
 * `RuntimeError("unexpectedResponse")` in words that name the operation's path, never read as a
 * shorter list (the port's `list` drops such an answer silently). The rows are the caller's to
 * read with `JsonView.listOf`, which fails a row that is no object.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { CORE_ROUTES } from "../core-routes.js"
import { type EnginePort, type OffsetWindow, PAGE_SIZE, pageQuery, type Query } from "../port.js"

/** What every page of a read carries: the operation, its query and the body of a POST. */
export interface PagedRead {
  readonly operationId: string
  readonly query: Query
  readonly body?: unknown
}

/** Where an operation reads, as the words of an unusable answer name it. */
function pathOf(operationId: string): string {
  return CORE_ROUTES[operationId]?.path ?? operationId
}

/**
 * The rows `read` lists in `window` (`firstResult`, then `maxResults`, after the query's own
 * values), checked to be a list.
 */
export async function readPage(
  port: EnginePort,
  read: PagedRead,
  window: OffsetWindow,
): Promise<readonly unknown[]> {
  const page: unknown = await port.json(read.operationId, {
    pathArgs: [],
    query: pageQuery(read.query, window.firstResult, window.maxResults),
    ...(read.body === undefined ? {} : { body: read.body }),
  })
  if (!Array.isArray(page)) {
    throw new RuntimeError("unexpectedResponse", `${pathOf(read.operationId)} is not a list`)
  }
  const rows: readonly unknown[] = page
  return rows
}

/**
 * Every row `read` lists from the row `from.firstResult` on, pages of `from.maxResults` (at least
 * one) until a page holds fewer: what an earlier page left, read to its end in the query's order.
 */
export async function readFrom(
  port: EnginePort,
  read: PagedRead,
  from: OffsetWindow,
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (;;) {
    const firstResult = from.firstResult + rows.length
    const page = await readPage(port, read, { firstResult, maxResults: from.maxResults })
    rows.push(...page)
    if (page.length < from.maxResults) return rows
  }
}

/**
 * Every row `operationId` lists for `query`: pages of 500 (`firstResult`, then `maxResults`,
 * after the query's own values) until a page holds fewer. A `body` (the query of a POST, its
 * order a total one so no page repeats or skips a row) goes with every page as it is.
 */
export async function readAll(
  port: EnginePort,
  operationId: string,
  query: Query,
  body?: unknown,
): Promise<unknown[]> {
  const read = body === undefined ? { operationId, query } : { operationId, query, body }
  return readFrom(port, read, { firstResult: 0, maxResults: PAGE_SIZE })
}
