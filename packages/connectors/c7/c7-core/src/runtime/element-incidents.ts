/**
 * The open root incidents at one element of a process, over every version of it
 * (`searchElementRootIncidents` of `C7Runtime`, beyond the engine contract, for the MCP server's
 * page of an activity's incidents): those Camunda 7 raised at the element and at its
 * multi-instance body, which it names by an id of its own (`multiInstanceBodyOf`), each row as the
 * engine answers it (`IncidentRow`), so a surface words its recovery and links its version. A copy
 * a call activity holds of a called instance's incident (`isRootIncident`) is none of them.
 *
 * `GET /incident` takes one activity id, so the element's list and its body's are paged apart,
 * each newest first and then by id by `TiedPages` from a cursor of its own (its runs of up to 500
 * rows raised at one instant read whole, a longer run at plain offsets), each page dropping the
 * copies and filling from further windows. The page merges the two newest first and then by id,
 * the order each list keeps, and its cursor names where each list goes on: `<element>,<body>`, a
 * cursor of `TiedPages` or `-` for a list read to its end, so every incident of either list comes
 * once, across pages too, with the bound `TiedPages` holds where the database orders a run of more
 * than 500 anew. Where a list's page stops at the bound of its requests with items to come, the
 * merged page ends before them, short or even empty, its cursor where that list goes on, so no
 * incident of the other list is taken before an older one of it. The body's list holds none on
 * most elements: its first page asks one window, and later pages none. A cursor that is none of
 * this paging fails as a `RangeError` before anything is read.
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

/** An element of a process's diagram, every version of the process. */
export interface ElementRef {
  readonly bpmnProcessId: BpmnProcessId
  readonly elementId: ElementId
}

/** A root incident raised at an element of an instance: its activity, instance and version named. */
export type ElementIncident = IncidentRow & {
  readonly activityId: string
  readonly processInstanceId: string
  readonly processDefinitionId: string
}

/** What separates the element's place from its body's in a cursor. */
const SEPARATOR = ","

/** The place of a list read to its end. */
const END = "-"

/** Where a list's next page starts: its first row (undefined), a cursor of it, or past its end. */
type Place = PageCursor | undefined | typeof END

function foreign(after: string): RangeError {
  return new RangeError(`"${after}" is not a page cursor of this engine`)
}

/** The element's place and its body's of the cursor `after`; both at their first row without one. */
function placesOf(after: PageCursor | undefined): readonly [Place, Place] {
  if (after === undefined) return [undefined, undefined]
  const parts = after.split(SEPARATOR)
  const places = parts.map((part) => (part === END ? END : PageCursor(part)))
  const [element, body] = places
  const known = places.every((place) => place === END || TiedPages.isCursor(place))
  if (places.length !== 2 || !known || element === undefined || body === undefined) {
    throw foreign(after)
  }
  return [element, body]
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

/** The incident that comes next and the list it heads, none where both pages are taken. */
function nextOf(
  element: ListHead,
  body: ListHead,
): { readonly head: ListHead; readonly incident: ElementIncident } | undefined {
  const [own, ofBody] = [element.first, body.first]
  if (own !== undefined && (ofBody === undefined || precedes(own, ofBody))) {
    return { head: element, incident: own }
  }
  return ofBody === undefined ? undefined : { head: body, incident: ofBody }
}

/** The first `limit` incidents of both lists' pages, newest first, and where each goes on. */
function mergedOf(element: ListHead, body: ListHead, limit: number): Page<ElementIncident> {
  const items: ElementIncident[] = []
  while (items.length < limit && !element.waits && !body.waits) {
    const next = nextOf(element, body)
    if (next === undefined) break
    next.head.advance()
    items.push(next.incident)
  }
  const places = [element.place, body.place]
  if (places.every((place) => place === END)) return { items }
  return { items, next: PageCursor(places.join(SEPARATOR)) }
}

/** Searches the root incidents at an element over an engine's port. */
export class ElementIncidentSearch {
  constructor(private readonly port: EnginePort) {}

  /** A page of the root incidents at `element` and its multi-instance body, newest first. */
  async search(element: ElementRef, page: PageRequest): Promise<Page<ElementIncident>> {
    const [own, ofBody] = placesOf(page.after)
    const byKey = { processDefinitionKeyIn: element.bpmnProcessId }
    const [elementPage, bodyPage] = await Promise.all([
      this.pageAt({ ...byKey, activityId: element.elementId }, own, page.limit),
      this.pageAt(
        { ...byKey, activityId: multiInstanceBodyOf(element.elementId) },
        ofBody,
        page.limit,
      ),
    ])
    return mergedOf(new ListHead(elementPage), new ListHead(bodyPage), page.limit)
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
