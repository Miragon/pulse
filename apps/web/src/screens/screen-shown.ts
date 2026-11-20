import { useEngineList, type ListedEngines } from "../engine-list.js"
import { hasEngineScreen } from "../frame/nav-sections.js"

/** What the page shows at a place of its own screens: the screen, the cockpit's view, or not yet. */
export type ScreenShown = "screen" | "fallback" | "deciding"

/**
 * Whether the page's screens serve `engine`: an engine the list names whose dialect has them on the
 * web (Camunda 7's), and, where the list could not be read, the screen, which words a refusal
 * itself. An engine of another dialect (shown on boards only), a refused profile and an engine the
 * server does not configure keep the cockpit's one state, as the frame showed them before the
 * screens: the list names each, so a screen never reads one of them.
 */
function shownFor(engine: string, list: ListedEngines | undefined, failed: boolean): ScreenShown {
  if (list === undefined) return failed ? "screen" : "deciding"
  const listed = list.engines?.find(({ id }) => id === engine)
  return listed !== undefined && hasEngineScreen(listed.dialect) ? "screen" : "fallback"
}

/**
 * What the page shows at a place of its own screens on `engine` (none: no screen), decided on the
 * frame's one read of the engine list, which the navigation and the cockpit share.
 */
export function useScreenShown(engine: string | undefined): ScreenShown {
  const { data, isError } = useEngineList()
  return engine === undefined ? "fallback" : shownFor(engine, data, isError)
}
