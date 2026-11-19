import { useEffect, type Dispatch } from "react"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData } from "../../view-models.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { type CockpitAction, type CockpitState, keptProcessKeys } from "./cockpit-state.js"

/**
 * After an engine switch (N7) the views a process key addresses stay where the new engine deploys
 * the key. Whether it does the engine overview's definitions say, read on the key its own route and
 * the landing read them by, so a switch from the landing or the fleet reads nothing new, and the
 * overview a missing key falls back to reads it anyway: a key it does not deploy falls back to the
 * head section, said under the head (`process-gone`). A read that fails changes nothing; the view
 * then says its own failure. An engine the cockpit shows without a section (`sectionless`: on
 * boards only, or its refused profile) is asked nothing: its one state reads nothing, and the check
 * waits until the reader moves on. The answer goes in after the switch's state committed, also from
 * a warm cache: the page's address then has the switch's entry before the fallback names it anew.
 */
export function useProcessCheck(
  state: CockpitState,
  sectionless: boolean,
  dispatch: Dispatch<CockpitAction>,
): void {
  const engine = state.scope.kind === "engine" ? state.scope.engineId : ""
  const keys = state.checkProcesses && !sectionless ? keptProcessKeys(state.stack) : []
  const overview = useToolQuery<CockpitDashboardData>(
    ["engine:cockpit-overview", engine],
    ENGINE_COCKPIT_OVERVIEW_DATA,
    { engine },
    { enabled: engine !== "" && keys.length > 0 },
  )
  const definitions = overview.data?.definitions
  // Undefined while nothing is asked or read yet; null where the engine deploys every key kept.
  const missing =
    definitions === undefined || keys.length === 0
      ? undefined
      : (keys.find((key) => !definitions.some((definition) => definition.key === key)) ?? null)
  useEffect(() => {
    if (missing === undefined) return
    dispatch(
      missing === null
        ? { type: "processes-kept" }
        : { type: "process-gone", engineId: engine, processDefinitionKey: missing },
    )
  }, [missing, engine, dispatch])
}
