import type { ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_OPEN_COCKPIT } from "../tool-names.js"
import { CockpitApp } from "./cockpit-app/app.js"

/**
 * The engine views by view name (= view tool name). The cockpit is the one engine view: it
 * routes itself, opening on the start view `engine_open_cockpit` names.
 */
export const engineViews: ViewMap = {
  [ENGINE_OPEN_COCKPIT]: CockpitApp,
}
