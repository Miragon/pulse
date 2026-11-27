/**
 * The runtime's process instances a search finds beside its scope and flags (the POST
 * `/process-instance` query and its count), in bodies the engine keeps (#717). A search names an
 * instance by a business key fragment OR by its whole id (the engine has no LIKE on ids), which one
 * body says only as a nested OR query (`orQueries`). Beside one the engine drops `withIncident`: it
 * reads that flag as an inner join of the open incidents, which an OR query turns into a left join,
 * so the body counts and lists every match (Operaton 2.1.5, CIB seven 2.2.0 and 3.0.0; Camunda 7's
 * mapper reads it alike). The scope, `active`, `suspended` and the incident's own fields hold, as
 * conditions of their own, but none of them reads every open incident: `incidentType` names one
 * type, and `incidentMessageLike` misses an incident without a message.
 *
 * So "with incident" under a search is the union of two top-level bodies: the business key half
 * and the id half, which matches at most one instance. Its count is the halves' counts less their
 * overlap; its page is the business key half's, with the id half's instance placed where the engine
 * sorts it, never where a comparison of ours would. Every other search is the one OR body it always
 * was. A caller builds the bodies here only, so none joins the flag and an OR query again.
 */

import { engineLike } from "./filters.js"

/**
 * What a search body narrows the instances by beside the search: the scope and the true-only flags
 * (`complementaryFlags`, `withIncidentBody`), and a business key pattern, which a search replaces.
 */
export interface InstanceBodyFilters {
  readonly processDefinitionKey?: string | undefined
  /** One tenant's instances (`tenantBody`): a process's, its key in that tenant. */
  readonly tenantIdIn?: string[] | undefined
  readonly withoutTenantId?: true | undefined
  readonly active?: true | undefined
  readonly suspended?: true | undefined
  readonly withIncident?: true | undefined
  /** A `…Like` pattern (`engineLike`); a search names the instances by itself and replaces it. */
  readonly businessKeyLike?: string | undefined
}

/** The search's OR query: a business key fragment OR a whole instance id. */
export interface InstanceOrQuery {
  readonly businessKeyLike: string
  readonly processInstanceIds: string[]
}

/** One body of the runtime's process-instance query, as its POST list and count take it. */
export interface InstanceSearchBody extends InstanceBodyFilters {
  readonly processInstanceIds?: string[]
  readonly orQueries?: InstanceOrQuery[]
}

/**
 * The bodies of a search: the one body, or, for "with incident" under a search, the business key
 * half, the id half and their overlap (an instance whose business key holds its own id).
 */
export type SearchedInstances =
  | { readonly term?: string; readonly body: InstanceSearchBody }
  | {
      readonly term: string
      readonly byKey: InstanceSearchBody
      readonly byId: InstanceSearchBody
      readonly overlap: InstanceSearchBody
    }

/** The rows of a list read from `firstResult` on, at most `maxResults` of them. */
export interface InstanceWindow {
  readonly firstResult: number
  readonly maxResults: number
}

/**
 * How a caller reads the runtime's process instances by a body: their count, and a window of their
 * rows in the caller's one total order, the same for every body (ties broken by the instance id).
 */
export interface InstanceBodyReads<Row> {
  count(body: InstanceSearchBody): Promise<number>
  list(body: InstanceSearchBody, window: InstanceWindow): Promise<readonly Row[]>
}

/** A row of a list read: the instance's id, which a row of an engine answer may lack. */
interface IdRow {
  readonly id?: string | null
}

/**
 * The bodies of the instances `filters` and the search `term` find. The term is trimmed (a pasted
 * id with a trailing space would match nothing) and replaces a business key pattern of `filters`;
 * its business key half is a substring match unless it places a wildcard itself. A blank or absent
 * term searches nothing: the one body of `filters`.
 */
export function searchedInstances(
  filters: InstanceBodyFilters,
  term: string | undefined,
): SearchedInstances {
  const value = term?.trim()
  if (!value) return { body: filters }
  const scope = { ...filters, businessKeyLike: undefined }
  const businessKeyLike = engineLike(value) ?? value
  const processInstanceIds = [value]
  if (filters.withIncident !== true) {
    return { term: value, body: { ...scope, orQueries: [{ businessKeyLike, processInstanceIds }] } }
  }
  return {
    term: value,
    byKey: { ...scope, businessKeyLike },
    byId: { ...scope, processInstanceIds },
    overlap: { ...scope, businessKeyLike, processInstanceIds },
  }
}

/**
 * How many instances `searched` finds: the one body's count, or the halves' less their overlap.
 * The three counts are requests of their own, each in its own transaction, so an incident opening
 * between them can count an instance whose business key holds its own id in the overlap and in
 * neither half: then the count is 0, never below.
 */
export async function countSearchedInstances(
  reads: InstanceBodyReads<unknown>,
  searched: SearchedInstances,
): Promise<number> {
  if ("body" in searched) return reads.count(searched.body)
  const [byKey, byId, overlap] = await Promise.all([
    reads.count(searched.byKey),
    reads.count(searched.byId),
    reads.count(searched.overlap),
  ])
  return Math.max(0, byKey + byId - overlap)
}

/**
 * The window of the instances `searched` finds, in the caller's order. For two halves the business
 * key half is read from one row before the window, so a page holds the same rows whether the id
 * half's instance sorts before, inside or after it; that instance joins only when the business key
 * half lacks it, and the engine sorts it among the rows read (a read of their ids): the window is
 * then that order less the row read early.
 */
export async function pageSearchedInstances<Row extends IdRow>(
  reads: InstanceBodyReads<Row>,
  searched: SearchedInstances,
  window: InstanceWindow,
): Promise<readonly Row[]> {
  if ("body" in searched) return reads.list(searched.body, window)
  const early = window.firstResult > 0 ? 1 : 0
  const [rows, [named], overlap] = await Promise.all([
    reads.list(searched.byKey, {
      firstResult: window.firstResult - early,
      maxResults: window.maxResults + early,
    }),
    reads.list(searched.byId, { firstResult: 0, maxResults: 1 }),
    reads.count(searched.overlap),
  ])
  const ids = rows.flatMap((row) => (row.id ? [row.id] : []))
  const joins = named?.id && overlap === 0 && !ids.includes(named.id) ? named.id : undefined
  if (joins === undefined) return rows.slice(early, early + window.maxResults)
  const sorted = [...ids, joins]
  const ordered = await reads.list(
    { processInstanceIds: sorted },
    { firstResult: 0, maxResults: sorted.length },
  )
  return ordered.slice(early, early + window.maxResults)
}
