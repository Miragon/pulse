/**
 * The open root incidents at one element of a process (`searchElementRootIncidents` of
 * `C7Runtime`, beyond the engine contract, for the MCP server's page of an activity's incidents):
 * those Camunda 7 raised at the element and at its multi-instance body, which it names by an id of
 * its own (`multiInstanceBodyOf`), each row as the engine answers it (`IncidentRow`), so a surface
 * words its recovery and links its version. A copy a call activity holds of a called instance's
 * incident (`isRootIncident`) is none of them. Over every version of its key in one search, or, of
 * one process (a key in one tenant) whose key holds others, over the versions it names
 * (`definitionIds`), each searched by its id: `GET /incident` names one version, and one tenant
 * only where there is one, so the engine reads none of another tenant's incidents.
 *
 * `GET /incident` takes one activity id, so the element's list and its body's are paged apart,
 * each newest first and then by id by `TiedPages` from a cursor of its own (its runs of up to 500
 * rows raised at one instant read whole, a longer run at plain offsets), each page dropping the
 * copies and filling from further windows. The page merges every list newest first and then by id,
 * the order each list keeps, and its cursor names where each list goes on: `<element>,<body>`, a
 * cursor of `TiedPages` or `-` for a list read to its end, per version `<id>=<element>,<body>`
 * joined by `;` (the id percent-encoded, a version read to its end left out), so every incident
 * of any list comes once, across pages too, with the bound `TiedPages` holds where the database
 * orders a run of more than 500 anew. A later page reads the versions its cursor names that are
 * still among those named: a version named since holds no incident older than the page before.
 * Where a list's page stops at the bound of its requests with items to come, the merged page ends
 * before them, short or even empty, its cursor where that list goes on, so no incident of another
 * list is taken before an older one of it. The body's list holds none on most elements: its first
 * page asks one window, and later pages none. A cursor that is none of this paging (a version's
 * for the key's search, or the key's for a process's) fails as a `RangeError` before anything is
 * read.
 */

import {
  type BpmnProcessId,
  type ElementId,
  type Page,
  PageCursor,
  type PageRequest,
} from "@miragon/pulse-engine-core"
import { multiInstanceBodyOf } from "../multi-instance-body.js"
import { type EnginePort, pageQuery, type Query } from "../port.js"
import { compareText } from "../records.js"
import { queryInput } from "../requests.js"
import { isRootIncident } from "../root-incident.js"
import { NEWEST_FIRST } from "../status-incidents.js"
import { type CursoredItem, type TiedRead, TiedPages } from "../tied-pages.js"
import { type IncidentRow, incidentRowsOf } from "./incident-rows.js"
import { timestampOf } from "./timestamps.js"

/** An element of a process's diagram: over every version of its key, or of one process. */
export interface ElementRef {
  readonly bpmnProcessId: BpmnProcessId
  readonly elementId: ElementId
  /**
   * The versions of one process, its key in one tenant, that may hold its incidents, each searched
   * by its id; without, every version of the key in one search.
   */
  readonly definitionIds?: readonly string[]
}

/** A root incident raised at an element of an instance: its activity, instance and version named. */
export type ElementIncident = IncidentRow & {
  readonly activityId: string
  readonly processInstanceId: string
  readonly processDefinitionId: string
}

/** What separates the element's place from its body's in a cursor. */
const SEPARATOR = ","

/** What separates the versions of a process's cursor. */
const VERSIONS = ";"

/** What separates a version's id from its places. */
const AT = "="

/** The place of a list read to its end. */
const END = "-"

/** Where a list's next page starts: its first row (undefined), a cursor of it, or past its end. */
type Place = PageCursor | undefined | typeof END

/** Where the element's list and its body's go on. */
type Places = readonly [Place, Place]

/** What a search reads: the key's every version, or one version, and where its two lists go on. */
interface Scope {
  /** The version's id; none for the key's. */
  readonly version?: string
  readonly query: Query
  readonly places: Places
}

function foreign(after: string): RangeError {
  return new RangeError(`"${after}" is not a page cursor of this engine`)
}

/** The element's place and its body's in `text`, a part of the cursor `after`. */
function placesIn(text: string, after: string): Places {
  const places = text.split(SEPARATOR).map((part) => (part === END ? END : PageCursor(part)))
  const [element, body] = places
  const known = places.every((place) => place === END || TiedPages.isCursor(place))
  if (places.length !== 2 || !known || element === undefined || body === undefined) {
    throw foreign(after)
  }
  return [element, body]
}

/** The id a cursor spells percent-encoded; none where it is no such spelling. */
function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text)
  } catch {
    return undefined
  }
}

/** A version of a process's cursor: its id and where its lists go on. */
interface VersionPlaces {
  readonly id: string
  readonly places: Places
}

/** A version's id and its places in `entry`, a part of the cursor `after`. */
function versionIn(entry: string, after: string): VersionPlaces {
  const [spelled, places, ...more] = entry.split(AT)
  const id = spelled === undefined ? undefined : decoded(spelled)
  if (!id || places === undefined || more.length > 0) throw foreign(after)
  return { id, places: placesIn(places, after) }
}

/** The versions the cursor `after` names, each once, and where each goes on. */
function versionsIn(after: PageCursor): readonly VersionPlaces[] {
  const named = after.split(VERSIONS).map((entry) => versionIn(entry, after))
  if (new Set(named.map(({ id }) => id)).size !== named.length) throw foreign(after)
  return named
}

/**
 * The versions of `ids` a page reads and where each goes on: every one from its first rows without
 * a cursor, else those the cursor names that are among them.
 */
function versionsOf(ids: readonly string[], after: PageCursor | undefined): readonly Scope[] {
  const asked = new Set(ids)
  const places: readonly VersionPlaces[] =
    after === undefined
      ? [...asked].map((id) => ({ id, places: [undefined, undefined] }))
      : versionsIn(after).filter(({ id }) => asked.has(id))
  return places.map(({ id, places: at }) => ({
    version: id,
    query: { processDefinitionId: id },
    places: at,
  }))
}

/** What `element` is searched over from the cursor `after`: its key, or one process's versions. */
function scopesOf(element: ElementRef, after: PageCursor | undefined): readonly Scope[] {
  if (element.definitionIds !== undefined) return versionsOf(element.definitionIds, after)
  const places: Places = after === undefined ? [undefined, undefined] : placesIn(after, after)
  return [{ query: { processDefinitionKeyIn: element.bpmnProcessId }, places }]
}

function isElementIncident(row: IncidentRow): row is ElementIncident {
  return (
    isRootIncident(row) &&
    row.activityId !== undefined &&
    row.processInstanceId !== undefined &&
    row.processDefinitionId !== undefined
  )
}

/**
 * Whether `left` comes before `right`: the newer first (the contract's timestamps, in UTC, order as
 * text), then by id, as `TiedPages` orders a run.
 */
function precedes(left: ElementIncident, right: ElementIncident): boolean {
  const newer = compareText(
    timestampOf(right.incidentTimestamp),
    timestampOf(left.incidentTimestamp),
  )
  return newer === 0 ? compareText(left.id, right.id) < 0 : newer < 0
}

/** A list's page in the merge: the items the merged page has not taken yet, and where it goes on. */
class ListHead {
  private taken = 0

  constructor(private readonly page: Page<CursoredItem<ElementIncident>>) {}

  /** The list's next incident on its page; none where the page has none left. */
  get first(): ElementIncident | undefined {
    return this.page.items[this.taken]?.item
  }

  /** Whether the list's next incident lies past its page, which the merged page must not pass. */
  get waits(): boolean {
    return this.first === undefined && this.page.next !== undefined
  }

  /** The merged page took the list's next incident. */
  advance(): void {
    this.taken += 1
  }

  /** Where the list goes on: its next incident on the page, else its page's cursor, else its end. */
  get place(): string {
    return this.page.items[this.taken]?.at ?? this.page.next ?? END
  }
}

/** The incident that comes next and the list it heads, none where every page is taken. */
function nextOf(
  heads: readonly ListHead[],
): { readonly head: ListHead; readonly incident: ElementIncident } | undefined {
  let next: { readonly head: ListHead; readonly incident: ElementIncident } | undefined
  for (const head of heads) {
    const incident = head.first
    if (incident !== undefined && (next === undefined || precedes(incident, next.incident))) {
      next = { head, incident }
    }
  }
  return next
}

/** The first `limit` incidents of the lists' pages, newest first, none past a list that waits. */
function mergedOf(heads: readonly ListHead[], limit: number): ElementIncident[] {
  const items: ElementIncident[] = []
  while (items.length < limit && !heads.some((head) => head.waits)) {
    const next = nextOf(heads)
    if (next === undefined) break
    next.head.advance()
    items.push(next.incident)
  }
  return items
}

/** Where each scope's two lists go on, none where every list is read to its end. */
function cursorOf(
  read: readonly { readonly scope: Scope; readonly heads: readonly ListHead[] }[],
): PageCursor | undefined {
  const open = read.flatMap(({ scope, heads }) => {
    const places = heads.map((head) => head.place)
    if (places.every((place) => place === END)) return []
    const joined = places.join(SEPARATOR)
    return [scope.version === undefined ? joined : encodeURIComponent(scope.version) + AT + joined]
  })
  return open.length === 0 ? undefined : PageCursor(open.join(VERSIONS))
}

/** Searches the root incidents at an element over an engine's port. */
export class ElementIncidentSearch {
  constructor(private readonly port: EnginePort) {}

  /** A page of the root incidents at `element` and its multi-instance body, newest first. */
  async search(element: ElementRef, page: PageRequest): Promise<Page<ElementIncident>> {
    const activities = [element.elementId, multiInstanceBodyOf(element.elementId)]
    const read = await Promise.all(
      scopesOf(element, page.after).map(async (scope) => {
        const pages = await Promise.all(
          activities.map((activityId, at) =>
            this.pageAt({ ...scope.query, activityId }, scope.places[at], page.limit),
          ),
        )
        return { scope, heads: pages.map((listed) => new ListHead(listed)) }
      }),
    )
    const items = mergedOf(
      read.flatMap(({ heads }) => heads),
      page.limit,
    )
    const next = cursorOf(read)
    return next === undefined ? { items } : { items, next }
  }

  /** The page of the root incidents `query` finds from `place`; none past the list's end. */
  private pageAt(
    query: Query,
    place: Place,
    limit: number,
  ): Promise<Page<CursoredItem<ElementIncident>>> {
    if (place === END) return Promise.resolve({ items: [] })
    const paging = new TiedPages(place === undefined ? { limit } : { limit, after: place })
    return paging.cursoredPageOf(this.read(query))
  }

  /** The rows of a window of the incidents `query` finds, newest first, each root incident kept. */
  private read(query: Query): TiedRead<ElementIncident> {
    return async (window) => {
      const request = pageQuery(
        { ...query, ...NEWEST_FIRST },
        window.firstResult,
        window.maxResults,
      )
      const rows = incidentRowsOf(await this.port.json("getIncidents", queryInput(request)))
      return rows.map((row) => ({
        key: timestampOf(row.incidentTimestamp),
        id: row.id,
        item: isElementIncident(row) ? row : undefined,
      }))
    }
  }
}
