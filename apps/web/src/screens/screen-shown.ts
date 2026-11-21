import { useEngineList, type ListedEngines } from "../engine-list.js"
import { sectionsOf, type NavSection } from "../frame/nav-sections.js"

/** What the page shows at a place of its own screens: the screen, the cockpit's view, or not yet. */
export type ScreenShown = "screen" | "fallback" | "deciding"

/**
 * Whether the page's screens serve `engine` at a place of `section`: an engine the list names whose
 * dialect has that section on the web (an engine's processes, a process and an instance: Camunda
 * 7's and Camunda 8's; an incident the page knows by its id alone, which it finds through the
 * cockpit's incident feed: Camunda 7's), and, where the list could not be read, the screen, which
 * words a refusal itself. An engine of another dialect, a refused profile and an engine the server
 * does not configure keep the cockpit's one state or its refusal, as the frame showed them before
 * the screens: the list names each, so a screen never reads one of them.
 */
function shownFor(
  engine: string,
  section: NavSection,
  list: ListedEngines | undefined,
  failed: boolean,
): ScreenShown {
  if (list === undefined) return failed ? "screen" : "deciding"
  const listed = list.engines?.find(({ id }) => id === engine)
  return listed !== undefined && sectionsOf(listed.dialect).includes(section)
    ? "screen"
    : "fallback"
}

/** The dialect the engine list names `engine` of; undefined while it reads, or for none it names. */
export function useEngineDialect(engine: string): string | undefined {
  return useEngineList().data?.engines?.find(({ id }) => id === engine)?.dialect
}

/**
 * What the page shows at a place of its own screens on `engine` (none: no screen), decided on the
 * frame's one read of the engine list, which the navigation and the cockpit share: by the section
 * the place belongs to (`section`, an engine's processes by default).
 */
export function useScreenShown(
  engine: string | undefined,
  section: NavSection = "processes",
): ScreenShown {
  const { data, isError } = useEngineList()
  return engine === undefined ? "fallback" : shownFor(engine, section, data, isError)
}
