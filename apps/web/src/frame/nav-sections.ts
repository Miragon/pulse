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
 * serves. The page's screens serve every dialect (an engine's processes, a process, an instance
 * and an incident under it: the screen feeds read the engine contract), so Camunda 8 opens its
 * processes too; the cockpit's routes the page embeds read the Camunda 7 REST API alone
 * (`ROUTE_DIALECTS`), so its incidents and jobs are Camunda 7's. `test/nav-sections.test.tsx`
 * holds this table to the routes `engine_open_cockpit` offers each dialect alone, to the dialects
 * of the engine screen's feed, and to the sections the cockpit's head shows an engine of each
 * dialect, rendered, so no head section a dialect serves goes missing and none it does not is
 * offered.
 */
export const NAV_SECTIONS: Readonly<Record<NavDialect, readonly NavSection[]>> = {
  c7: ["processes", "incidents", "jobs"],
  c8: ["processes"],
}

/**
 * The dialects whose engines the cockpit's view across engines reads (its fleet, which reads each
 * engine's overview: Camunda 7's alone), so the navigation offers that view where it reads two
 * engines or more, as the cockpit does.
 */
export const FLEET_DIALECTS: readonly NavDialect[] = ["c7"]

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

/**
 * Whether the cockpit's view across engines reads an engine of `dialect` whole: one it names
 * without a dialect is Camunda 7's, as the cockpit reads it.
 */
export function inFleet(dialect: string | undefined): boolean {
  return dialect === undefined || (FLEET_DIALECTS as readonly string[]).includes(dialect)
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
