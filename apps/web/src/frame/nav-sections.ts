import type { Place } from "../router/routes.js"

/**
 * A section of an engine the side navigation offers: the page's own engine screen (its processes,
 * at the engine's own address, which the cockpit's overview had until the page claimed it), and
 * the cockpit's head sections the page shows embedded (its incidents, its jobs), which the cockpit
 * leaves to the page on a page with chrome of its own.
 */
export type NavSection = "processes" | "incidents" | "jobs"

/** A dialect `engine_list_engines` names an engine of. */
export type NavDialect = "c7" | "c8"

/**
 * The sections the navigation opens under an engine, per dialect, in the head's order: what the
 * page shows of each dialect on the web, its own screen first, then the cockpit's routes it
 * serves. Camunda 8 has none until the page's screens serve it: the page shows such an engine on
 * boards only. `test/nav-sections.test.tsx` holds this table to the routes `engine_open_cockpit`
 * offers each dialect alone, to the dialects of the engine screen's feed, and to the sections the
 * cockpit's head shows an engine of each dialect, rendered, so no head section a dialect serves
 * goes missing.
 */
export const NAV_SECTIONS: Readonly<Record<NavDialect, readonly NavSection[]>> = {
  c7: ["processes", "incidents", "jobs"],
  c8: [],
}

/**
 * The cockpit's view whose place each section opens: the engine screen at the overview's place
 * (the engine's own address), the others at their own.
 */
export const SECTION_VIEWS: Readonly<Record<NavSection, string>> = {
  processes: "overview",
  incidents: "incidents",
  jobs: "jobs",
}

/** The sections of an engine of `dialect`; none for a dialect the page does not know. */
export function sectionsOf(dialect: string | undefined): readonly NavSection[] {
  return dialect !== undefined && Object.hasOwn(NAV_SECTIONS, dialect)
    ? NAV_SECTIONS[dialect as NavDialect]
    : []
}

/** Whether the page shows an engine of `dialect` on its own engine screen. */
export function hasEngineScreen(dialect: string | undefined): boolean {
  return sectionsOf(dialect).includes("processes")
}

/** The place a section of `engine` opens. */
export function placeOfSection(section: NavSection, engine: string): Place {
  return { view: SECTION_VIEWS[section], engine }
}

/**
 * The section `place` is the page of: the engine screen at the engine's own address, a head
 * section's own view, never a drill (the jobs of one process are one), which the navigation then
 * marks current.
 */
export function sectionAt(place: Place): NavSection | undefined {
  const { view, processDefinitionKey } = place
  if (view === "overview") return "processes"
  if (view === "incidents") return view
  return view === "jobs" && processDefinitionKey === undefined ? "jobs" : undefined
}
