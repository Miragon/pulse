import { useEffect, type Dispatch } from "react"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData, DefinitionStat } from "../../view-models.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import {
  type CockpitAction,
  type CockpitState,
  type KeptProcess,
  keptProcesses,
} from "./cockpit-state.js"

/**
 * Whether a row of the overview's processes is the kept process: its key, in the tenant the view
 * names (a row without a tenant for null), in any tenant where it names none.
 */
function deploys(row: DefinitionStat, kept: KeptProcess): boolean {
  if (row.key !== kept.key) return false
  return kept.tenantId === undefined || (row.tenantId ?? null) === kept.tenantId
}

/**
 * After an engine switch (N7) the views a process addresses stay where the new engine deploys the
 * process: its key, in the tenant a view names. Whether it does the engine overview's processes say
 * (one row per key and tenant), read on the key its own route and
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
  const kept = state.checkProcesses && !sectionless ? keptProcesses(state.stack) : []
  const overview = useToolQuery<CockpitDashboardData>(
    ["engine:cockpit-overview", engine],
    ENGINE_COCKPIT_OVERVIEW_DATA,
    { engine },
    { enabled: engine !== "" && kept.length > 0 },
  )
  const definitions = overview.data?.definitions
  // Undefined while nothing is asked or read yet; null where the engine deploys every process kept.
  const missing =
    definitions === undefined || kept.length === 0
      ? undefined
      : (kept.find((process) => !definitions.some((row) => deploys(row, process))) ?? null)
  useEffect(() => {
    if (missing === undefined) return
    dispatch(
      missing === null
        ? { type: "processes-kept" }
        : { type: "process-gone", engineId: engine, process: missing },
    )
  }, [missing, engine, dispatch])
}
