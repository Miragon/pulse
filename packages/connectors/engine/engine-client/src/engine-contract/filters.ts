/**
 * Query filters. Two engine behaviours turn a plausible filter into a silent
 * no-op, so the tools never forward a filter value as given:
 *
 * - Boolean filters are TRUE-ONLY: `true` narrows the result, `false` is
 *   IGNORED (HTTP 200, no filter) — neither a negation nor a 400. A forwarded
 *   `suspended=false` would return the suspended instances to a caller who
 *   asked for the opposite. Flags go out only when `true`; where the engine
 *   has the complementary flag (active/suspended, finished/unfinished, …), a
 *   `false` is sent as `true` on the other side instead.
 * - `…Like` filters are SQL LIKE patterns: without a `%` they match the whole
 *   value exactly, so "substring" search silently became an exact match.
 */

/** A true-only engine flag: `true` stays, `false`/absent is not sent at all. */
export function trueOnly(flag: boolean | undefined): true | undefined {
  return flag === true ? true : undefined
}

/**
 * Two complementary true-only flags, e.g. `active`/`suspended`: each is sent
 * when it is `true` OR its complement is `false`.
 *
 * A pair that asks for both states or neither (`true`/`true`,
 * `false`/`false`) throws a RangeError (a tool error). The engine has no
 * honest answer to it: active/suspended (process instances, jobs) and
 * withRetriesLeft/noRetriesLeft (external tasks) set ONE query field, so the
 * engine keeps the flag it applies last and returns one state as if it were
 * the filtered result; the separate-field pairs return nothing.
 */
export function complementaryFlags<A extends string, B extends string>(
  flags: Partial<Record<A | B, boolean>>,
  first: A,
  second: B,
): Partial<Record<A | B, true>> {
  const wanted: Partial<Record<A | B, true>> = {}
  if (flags[first] === true || flags[second] === false) wanted[first] = true
  if (flags[second] === true || flags[first] === false) wanted[second] = true
  if (wanted[first] && wanted[second]) {
    throw new RangeError(
      `${first}: ${flags[first]} and ${second}: ${flags[second]} contradict each other — pass one of them (false selects the other state), or neither for both states.`,
    )
  }
  return wanted
}

/**
 * A `…Like` filter value: wrapped in `%` (a substring match) unless the
 * caller already placed a wildcard; empty/absent sends nothing.
 */
export function engineLike(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.includes("%") ? value : `%${value}%`
}

/**
 * A comma-list `…In` filter from single and list inputs (`processDefinitionKey`
 * + `processDefinitionKeyIn`), de-duplicated; nothing sent when both are empty.
 */
export function engineKeyList(...parts: Array<string | readonly string[] | undefined>) {
  const values = [...new Set(parts.flat().filter((value): value is string => !!value))]
  return values.length > 0 ? values.join(",") : undefined
}

/**
 * A search box over process instances, matching what a list names an instance
 * by: its business key as a substring OR its whole id. The engine has no LIKE
 * on ids (`processInstanceIds` matches whole ids only), so a pasted id is
 * found and a fragment of one is not. Sent as ONE nested OR query of the POST
 * `/process-instance` (and `/count`) body, which the engine ANDs with the
 * other filters; a blank term sends nothing. The term is trimmed: a pasted
 * id with a trailing space would match nothing.
 */
export function engineInstanceSearch(term: string | undefined): {
  orQueries?: Array<{ businessKeyLike: string; processInstanceIds: string[] }>
} {
  const value = term?.trim()
  if (!value) return {}
  return {
    orQueries: [{ businessKeyLike: engineLike(value) ?? value, processInstanceIds: [value] }],
  }
}
