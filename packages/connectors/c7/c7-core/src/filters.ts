/**
 * Query filters. Two engine behaviours turn a plausible filter into a silent
 * no-op, so the tools never forward a filter value as given:
 *
 * - Boolean filters are TRUE-ONLY: `true` narrows the result, `false` is
 *   IGNORED (HTTP 200, no filter): neither a negation nor a 400. A forwarded
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
export function engineKeyList(...parts: (string | readonly string[] | undefined)[]) {
  const values = [...new Set(parts.flat().filter((value): value is string => !!value))]
  return values.length > 0 ? values.join(",") : undefined
}

/**
 * One tenant's runs in a read of the runtime or the history (instances, jobs): a query's
 * `tenantIdIn` naming the tenant, or `withoutTenantId` for the runs of no tenant (null), never an
 * empty `tenantIdIn`, which the engine reads as no filter. A run's tenant is its version's, but
 * where Camunda 7's shared definitions run instances a tenant id provider gave a tenant: such a run
 * reads under that tenant, while the definition statistics count it under its version's. `GET
 * /incident` takes no `withoutTenantId` (it would read every tenant's), so a process's incidents
 * are read by its versions' ids instead (`ElementRef.definitionIds`).
 */
export type TenantQuery = { readonly tenantIdIn: string } | { readonly withoutTenantId: true }

/** The query of one tenant's runs (`TenantQuery`), as a `GET` read's query spells it. */
export function tenantQuery(tenantId: string | null): TenantQuery {
  return tenantId === null ? { withoutTenantId: true } : { tenantIdIn: tenantId }
}

/** The same filter as a `POST` read's body spells it, `tenantIdIn` a list. */
export type TenantBody = { readonly tenantIdIn: string[] } | { readonly withoutTenantId: true }

/** The body of one tenant's runs (`tenantQuery` as a body spells it). */
export function tenantBody(tenantId: string | null): TenantBody {
  return tenantId === null ? { withoutTenantId: true } : { tenantIdIn: [tenantId] }
}
