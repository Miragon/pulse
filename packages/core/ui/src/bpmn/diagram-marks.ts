/**
 * What a diagram draws on its elements, as data: the counts of each element (the shared screens'
 * diagram decorations, `DiagramDecorations.of` of `@miragon/pulse-screens`, typed here by their
 * shape alone, since the kit imports no other package) and its outline. Framework-free, so the
 * rules are tested apart from bpmn-js.
 */

/**
 * What a badge on an element counts: its open root incidents, the incidents in the instances it
 * called (never part of its incident count), its running instances.
 */
export type DiagramCountKind = "incidents" | "incidentsInCalledInstances" | "running"

/** One count on an element: its kind and its number. */
export interface DiagramCount {
  readonly kind: DiagramCountKind
  readonly count: number
}

/**
 * An element's decoration: its counts, each drawn as its own badge, and whether it holds a root
 * incident, which outlines it in the incident's colour. The screens' `ElementDecorationData` is
 * one (its scope and call target ride along).
 */
export interface DiagramDecoration<C extends DiagramCount = DiagramCount> {
  readonly elementId: string
  readonly counts: readonly C[]
  readonly incident: boolean
}

/**
 * An outline without a count: where an instance waits (`running`), an open user task (a heavier
 * dashed stroke, shape not colour), an incident.
 */
export type DiagramMarkerKind = "running" | "openTask" | "incident"

export interface DiagramMarker {
  readonly elementId: string
  readonly kind: DiagramMarkerKind
}

/** The badges of an element left to right: its root incidents first, its running instances last. */
export const COUNT_ORDER: readonly DiagramCountKind[] = [
  "incidents",
  "incidentsInCalledInstances",
  "running",
]

/** The canvas's marker of each kind (`BPMN_OVERLAY_CSS`). */
export const MARKER_CLASS: Readonly<Record<DiagramMarkerKind, string>> = {
  running: "highlight-running",
  openTask: "highlight-open-user-task",
  incident: "highlight-incident",
}

/** One outline an element: the incident over an open task over a wait, so no two fills compete. */
const MARKER_ORDER: readonly DiagramMarkerKind[] = ["incident", "openTask", "running"]

/** The counts a badge shows, in the badges' order: none of 0 (or no number), none twice. */
export function shownCounts<C extends DiagramCount>(counts: readonly C[]): C[] {
  return COUNT_ORDER.flatMap((kind) => {
    const count = counts.find((entry) => entry.kind === kind)
    return count !== undefined && Number.isFinite(count.count) && count.count > 0 ? [count] : []
  })
}

/** An element the diagram counts on, its counts as the badges show them. */
export interface CountedElement<C extends DiagramCount = DiagramCount> {
  readonly elementId: string
  readonly counts: readonly C[]
}

/** The elements with a count to show, each once (its first decoration), in the given order. */
export function countedElements<C extends DiagramCount>(
  decorations: readonly DiagramDecoration<C>[],
): CountedElement<C>[] {
  const seen = new Set<string>()
  return decorations.flatMap(({ elementId, counts }) => {
    if (seen.has(elementId)) return []
    seen.add(elementId)
    const shown = shownCounts(counts)
    return shown.length > 0 ? [{ elementId, counts: shown }] : []
  })
}

/**
 * The outline of each element: a root incident of the decorations, else the strongest of the
 * markers it is given (an incident, then an open task, then a wait). One per element.
 */
export function outlinesOf(
  decorations: readonly DiagramDecoration[],
  markers: readonly DiagramMarker[],
): DiagramMarker[] {
  const outlines = new Map<string, DiagramMarkerKind>()
  const offer = (elementId: string, kind: DiagramMarkerKind) => {
    const held = outlines.get(elementId)
    if (held === undefined || MARKER_ORDER.indexOf(kind) < MARKER_ORDER.indexOf(held)) {
      outlines.set(elementId, kind)
    }
  }
  for (const { elementId, incident } of decorations) if (incident) offer(elementId, "incident")
  for (const { elementId, kind } of markers) offer(elementId, kind)
  return [...outlines].map(([elementId, kind]) => ({ elementId, kind }))
}

/**
 * Where the first zoom in after a fit centres: the outlined elements of the strongest kind, else
 * the elements with a count, so a phone that fits the whole process small zooms to what it shows.
 */
export function centredIdsOf(
  outlines: readonly DiagramMarker[],
  counted: readonly CountedElement[],
): string[] {
  for (const kind of MARKER_ORDER) {
    const ids = outlines.filter((outline) => outline.kind === kind).map((o) => o.elementId)
    if (ids.length > 0) return ids
  }
  return counted.map(({ elementId }) => elementId)
}

/**
 * What the drawing is decorated with, as one key: bpmn-js adds a marker or an overlay and keeps
 * it, so a new outline or a new element with counts draws the diagram anew; a count that changes
 * on an element that has counts changes in place, whatever order the decorations come in (a feed
 * sorted by its counts reorders them as they change), so a refresh keeps the reader's zoom.
 */
export function drawnKeyOf(
  counted: readonly CountedElement[],
  outlines: readonly DiagramMarker[],
): string {
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return JSON.stringify([
    counted.map(({ elementId }) => elementId).sort(order),
    outlines
      .map(({ elementId, kind }) => [elementId, kind] as const)
      .sort((a, b) => order(a[0], b[0]) || order(a[1], b[1])),
  ])
}
