import { useMemo } from "react"
import { parseBpmnNames, readBpmnNames } from "@miragon/pulse-widget-shell/widgets"

/** The process's name as the cockpit shows it: the pool's or the process's in the XML, else the key. */
export function processNameOf(xml: string | null | undefined, key: string): string {
  return (xml ? parseBpmnNames(xml, key).name : null) ?? key
}

/**
 * The names of a diagram's elements (the one BPMN name reader every Pulse surface uses), with the
 * engine's own name as the fallback, else none (`NamedId` then shows the id once).
 */
export function useElementNames(
  xml: string | null | undefined,
): (elementId: string, fallback?: string | null) => string | null {
  const elements = useMemo(() => (xml ? readBpmnNames(xml).elements : {}), [xml])
  return (elementId, fallback) =>
    (Object.hasOwn(elements, elementId) ? elements[elementId] : null) ?? fallback ?? null
}

/**
 * The id of a row the diagram's counts lead to: an activity's open root incidents, its line of the
 * incidents in the instances it called, a task's open tasks. Each list has ids of its own, so an
 * activity with both kinds of incidents holds two anchors, never one id twice.
 */
export function rowAnchor(list: "incidents" | "calledIncidents" | "tasks", id: string): string {
  return `${list}-row-${id}`
}

/**
 * Takes the viewer to the first of `anchors` the page holds: scrolls it into view (smoothly, unless
 * the viewer asked for reduced motion) and moves the focus to it (each anchor has `tabIndex` -1),
 * so a keyboard or a screen reader follows. False when the page holds none of them.
 */
export function goTo(anchors: readonly string[]): boolean {
  const target = anchors
    .map((anchor) => document.getElementById(anchor))
    .find((element) => element !== null)
  if (target === undefined) return false
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" })
  target.focus({ preventScroll: true })
  return true
}
