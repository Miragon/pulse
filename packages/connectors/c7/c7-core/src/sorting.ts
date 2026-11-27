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
