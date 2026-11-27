import { OutsideAnyProcessNotice } from "@miragon/pulse-blocks"
import type { EngineRead } from "./start-reads.js"

/**
 * Under the start page's bar, after the engines' failures, each engine's root incidents outside
 * any process that its verdict judged (a batch's or the history cleanup's failed job), named by the
 * engine: the engine table's incidents are its processes', so its state may be degraded beside 0
 * incidents, and this line says why, never summed into its figures (owner decision of 2026-11-26).
 * Nothing for an engine without one, nor for one whose verdict shows none.
 */
export function StartOutside({ reads }: { reads: readonly EngineRead[] }) {
  return (
    <>
      {reads.map(({ engine, outside }) => (
        <OutsideAnyProcessNotice key={engine} engine={engine} outside={outside} />
      ))}
    </>
  )
}
