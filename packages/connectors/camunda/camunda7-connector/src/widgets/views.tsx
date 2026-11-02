import type { ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { CAMUNDA7_OPEN_COCKPIT } from "../tool-names.js"
import { CockpitApp } from "./cockpit-app/app.js"

/**
 * The camunda7 views by view name (= view tool name). The cockpit is the one camunda7 view: it
 * routes itself, opening on the start view `camunda7_open_cockpit` names.
 */
export const camunda7Views: ViewMap = {
  [CAMUNDA7_OPEN_COCKPIT]: CockpitApp,
}
