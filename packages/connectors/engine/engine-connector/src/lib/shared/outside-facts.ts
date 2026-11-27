import type { EngineHealthData } from "../../view-models.js"

/**
 * The facts the model reads of an engine's open root incidents outside any process, apart from
 * the processes' `openRootIncidents`, in `engine_open_cockpit`'s overview, the view's context and
 * its hand-off alike: their count where the scan read them all, its lower bound where it stopped
 * (`…AtLeast`), neither without one, nor for a payload that carries none (a capped scan vouches
 * only for what it read, #335).
 */
export function outsideFacts(outside: EngineHealthData["summary"]["outsideAnyProcess"]) {
  const count = outside?.count ?? 0
  const atLeast = outside?.atLeast === true
  return {
    rootIncidentsOutsideAnyProcess: count > 0 && !atLeast ? count : undefined,
    rootIncidentsOutsideAnyProcessAtLeast: count > 0 && atLeast ? count : undefined,
  }
}
