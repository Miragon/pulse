/**
 * Query sorting. Every engine list query sorts only by an explicit PAIR:
 * `sortBy` without `sortOrder` (or the reverse) is a 400 "Only a single
 * sorting parameter specified. sortBy and sortOrder required". The tools keep
 * both parameters optional and pair them here instead.
 */

export type SortOrder = "asc" | "desc"

/**
 * The sort pair a list query sends: a `sortBy` alone sorts ascending, a
 * `sortOrder` alone has no field to apply to and is dropped: never one
 * without the other.
 */
export function engineSorting<TField extends string>(args: {
  sortBy?: TField
  sortOrder?: SortOrder
}): { sortBy?: TField; sortOrder?: SortOrder } {
  if (!args.sortBy) return {}
  return { sortBy: args.sortBy, sortOrder: args.sortOrder ?? "asc" }
}

/**
 * The one order of an instance's history, the `sorting` of `POST /history/activity-instance`: by
 * start, then by occurrence (the engine's sequence counter, which orders the steps one execution
 * starts within a millisecond), then by id, which breaks every tie left, since the steps of
 * parallel branches or of a multi-instance's items start within a millisecond on executions of
 * their own. A total order, so pages cut by offset neither repeat nor skip a step, and the steps a
 * running instance starts later come after the ones before. The GET of that path sorts by one key,
 * so a read of an instance's path sends this body.
 */
export const INSTANCE_HISTORY_ORDER = [
  { sortBy: "startTime", sortOrder: "asc" },
  { sortBy: "occurrence", sortOrder: "asc" },
  { sortBy: "activityInstanceId", sortOrder: "asc" },
] as const

/** The query (the body of the POST) of every step of instance `id`, in the history's order. */
export function instanceHistoryQuery(id: string) {
  return { processInstanceId: id, sorting: INSTANCE_HISTORY_ORDER }
}

/** A key of the history's activity instances that its POST sorts by. */
type HistoryKey = (typeof INSTANCE_HISTORY_ORDER)[number]["sortBy"]

/**
 * The `sorting` of a POST of the history's activity instances that a caller sorts by its pair (as
 * `engineSorting` pairs it): that pair first, then `INSTANCE_HISTORY_ORDER` for its ties, so pages
 * cut by offset hold each step once whatever the key; a start ascending is that order itself.
 * Undefined without a key: the engine then orders by id, which is total too.
 */
export function historySorting<TField extends string>(args: {
  sortBy?: TField
  sortOrder?: SortOrder
}): { sortBy: TField | HistoryKey; sortOrder: SortOrder }[] | undefined {
  const { sortBy, sortOrder } = engineSorting(args)
  if (sortBy === undefined || sortOrder === undefined) return undefined
  const ties = INSTANCE_HISTORY_ORDER.filter((key) => key.sortBy !== sortBy)
  return [{ sortBy, sortOrder }, ...ties]
}
