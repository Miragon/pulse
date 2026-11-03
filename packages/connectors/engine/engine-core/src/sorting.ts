/**
 * Query sorting. Every engine list query sorts only by an explicit PAIR:
 * `sortBy` without `sortOrder` (or the reverse) is a 400 "Only a single
 * sorting parameter specified. sortBy and sortOrder required". The tools keep
 * both parameters optional and pair them here instead.
 */

export type SortOrder = "asc" | "desc"

/**
 * The sort pair a list query sends: a `sortBy` alone sorts ascending, a
 * `sortOrder` alone has no field to apply to and is dropped — never one
 * without the other.
 */
export function engineSorting<TField extends string>(args: {
  sortBy?: TField
  sortOrder?: SortOrder
}): { sortBy?: TField; sortOrder?: SortOrder } {
  if (!args.sortBy) return {}
  return { sortBy: args.sortBy, sortOrder: args.sortOrder ?? "asc" }
}
