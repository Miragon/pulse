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
