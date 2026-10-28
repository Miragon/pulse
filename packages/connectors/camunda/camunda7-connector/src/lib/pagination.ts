import { z } from "zod"

/** A raw capped array can't tell "20 returned" from "exactly 20 exist"; `items` stays unknown on purpose, the envelope is the contract. */
export const paginatedListOutput = z.object({
  items: z.array(z.unknown()).describe("One page of results"),
  totalCount: z.number().int().describe("Total number of results matching the filters"),
  hasMore: z.boolean().describe("Whether more results exist beyond this page"),
  nextOffset: z
    .number()
    .int()
    .optional()
    .describe("Present when hasMore is true: pass as firstResult to fetch the next page"),
})

export type PaginatedList<T> = {
  items: T[]
  totalCount: number
  hasMore: boolean
  nextOffset?: number
}

/** Without a usable count, `hasMore` degrades to false instead of inventing pages. */
export function toPaginatedList<T>(
  itemsRaw: unknown,
  countRaw: unknown,
  firstResult: number | undefined,
): PaginatedList<T> {
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []) as T[]
  const offset = firstResult ?? 0
  const count = (countRaw as { count?: number } | null | undefined)?.count
  const totalCount = typeof count === "number" ? count : offset + items.length
  const hasMore = totalCount > offset + items.length
  return {
    items,
    totalCount,
    hasMore,
    ...(hasMore ? { nextOffset: offset + items.length } : {}),
  }
}
