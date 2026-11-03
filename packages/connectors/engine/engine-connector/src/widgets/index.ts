import { ENGINE_LANDSCAPE_WIDGET } from "./cockpit-app/fleet-view.js"

export { engineViews } from "./views.js"

/** Other modules' host widgets the engine module renders by raw id; a composition root checks each exists. */
export const ENGINE_HOST_WIDGET_REFS = [ENGINE_LANDSCAPE_WIDGET] as const
