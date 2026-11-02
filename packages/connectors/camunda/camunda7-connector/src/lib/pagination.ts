import { z } from "zod"

/**
 * A raw capped array can't tell "20 returned" from "exactly 20 exist"; `items` stays unknown on purpose, the envelope is the contract.
 * No property descriptions: the camunda7 module instructions state the paging contract once.
 */
export const paginatedListOutput = z.object({
  items: z.array(z.unknown()),
  totalCount: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().optional(),
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
