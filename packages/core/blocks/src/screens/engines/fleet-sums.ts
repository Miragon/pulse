import { FleetSums, type EngineScreenData, type FleetSumsData } from "@miragon/pulse-screens"
import { useMemo } from "react"

/**
 * The engine screens of several engines summed in the browser (`FleetSums` of
 * `@miragon/pulse-screens`: counts only, never a rate): each engine's row and what runs where, for
 * `EngineTable` and `ProcessesByEngine`. An engine whose read failed is left out of `screens`.
 */
export function useFleetSums(screens: readonly EngineScreenData[]): FleetSumsData {
  return useMemo(() => FleetSums.of(screens), [screens])
}
