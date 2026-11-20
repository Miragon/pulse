import type { Place } from "../router/routes.js"

/**
 * A section of an engine the side navigation offers: one of the cockpit's head sections (its
 * overview, its incidents, its jobs), which the page shows at its own address and which the
 * cockpit leaves to the page on a page with chrome of its own.
 */
export type NavSection = "overview" | "incidents" | "jobs"

/** A dialect `engine_list_engines` names an engine of. */
export type NavDialect = "c7" | "c8"

/**
 * The sections the navigation opens under an engine, per dialect, in the head's order: what the
 * page shows of each dialect on the web, the cockpit's routes it serves. Camunda 8 has none until
 * its screens serve it: the page shows such an engine on boards only.
 * `test/nav-sections.test.tsx` holds this table to the routes `engine_open_cockpit` offers each
 * dialect alone and to the sections the cockpit's head shows an engine of each dialect, rendered,
 * so no head section a dialect serves goes missing.
 */
export const NAV_SECTIONS: Readonly<Record<NavDialect, readonly NavSection[]>> = {
  c7: ["overview", "incidents", "jobs"],
  c8: [],
}

/** The sections of an engine of `dialect`; none for a dialect the page does not know. */
export function sectionsOf(dialect: string | undefined): readonly NavSection[] {
  return dialect !== undefined && Object.hasOwn(NAV_SECTIONS, dialect)
    ? NAV_SECTIONS[dialect as NavDialect]
    : []
}

/**
 * The section `place` is the page of: a head section's own view, never a drill (the jobs of one
 * process are one), which the navigation then marks current.
 */
export function sectionAt(place: Place): NavSection | undefined {
  const { view, processDefinitionKey } = place
  if (view === "overview" || view === "incidents") return view
  return view === "jobs" && processDefinitionKey === undefined ? "jobs" : undefined
}
