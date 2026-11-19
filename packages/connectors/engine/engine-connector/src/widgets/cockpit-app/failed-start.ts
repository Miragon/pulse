import { isPermanentError } from "@miragon/pulse-widget-shell/widgets"
import type { AppSection, CockpitAppData, CockpitSection, CockpitView } from "../../view-models.js"
import { ROUTE_DIALECTS } from "../../view-models.dialects.js"

/** The app's own routes, which open no engine of the cockpit. */
const APP_SECTIONS: ReadonlySet<string> = new Set<AppSection>(["board", "landing"])

/** A section of a route of one engine, as a page's `view` names it. */
function isEngineSection(view: unknown): view is CockpitSection {
  return typeof view === "string" && Object.hasOwn(ROUTE_DIALECTS, view) && !APP_SECTIONS.has(view)
}

/**
 * The cockpit's data for a page whose start of one engine's view failed for that engine (it does
 * not answer, it fails, it is slow): that engine and its view without data, so the cockpit keeps
 * its head over the route, which reads the engine itself and says the failure in its place, as when
 * the engine is opened from the start page. Null leaves the failure to the page's frame: a refusal
 * no retry changes (a refused profile, a view of an engine shown on boards only, arguments the tool
 * does not take, an ended session) and a start that names no engine, whose default the page does
 * not know. `args` are the view tool's, as the page called it.
 */
export function cockpitAfterFailedStart(
  args: Readonly<Record<string, unknown>>,
  error: Error,
): CockpitAppData | null {
  const { engine, view = "overview", ...ids } = args
  if (isPermanentError(error) || typeof engine !== "string" || engine === "") return null
  if (!isEngineSection(view)) return null
  const startView = { ...ids, section: view } as CockpitView
  return { engineId: engine, engines: [], start: null, startView }
}
