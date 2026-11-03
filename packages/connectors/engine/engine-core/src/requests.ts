/** Requests over id lists: chunks of 50 ids, at most `PARALLEL` at a time. */

import { type EnginePort, type OperationInput, PARALLEL, type Query } from "./port.js"
import { countOf, type Rec } from "./records.js"
import { mapLimit } from "./util.js"

/** Ids per request of a query parameter that takes a comma separated list (URL length). */
export const ID_CHUNK = 50

/** A request without path arguments. */
export function queryInput(query: Query): OperationInput {
  return { pathArgs: [], query }
}

/** `ids` in chunks of `ID_CHUNK`, each joined with commas. */
function idChunks(ids: readonly string[]): string[] {
  const chunks: string[] = []
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    chunks.push(ids.slice(start, start + ID_CHUNK).join(","))
  }
  return chunks
}

/** A list or count request over an id list (`processInstanceIds`, ...): `key` takes the ids. */
export interface IdRequest {
  readonly operationId: string
  readonly key: string
  readonly ids: readonly string[]
  readonly query?: Query
  /** Items per chunk at most (lists only). */
  readonly cap?: number
}

/**
 * The summed `count` of a count operation over an id list, sent in chunks of 50 ids; no ids give
 * 0 without a request.
 */
export async function countByIds(port: EnginePort, request: IdRequest): Promise<number> {
  const counts = await mapLimit(idChunks(request.ids), PARALLEL, async (chunk) => {
    const query = { ...request.query, [request.key]: chunk }
    return countOf(await port.json(request.operationId, queryInput(query)))
  })
  return counts.reduce((sum, count) => sum + count, 0)
}

/** The items of a list operation over an id list, chunked like `countByIds` and concatenated. */
export async function listByIds(port: EnginePort, request: IdRequest): Promise<Rec[]> {
  const pages = await mapLimit(idChunks(request.ids), PARALLEL, async (chunk) =>
    port.list(request.operationId, { ...request.query, [request.key]: chunk }, request.cap),
  )
  return pages.flatMap((page) => page.items)
}
