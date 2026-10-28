import type { ViewMetaEngines } from "@miragon/pulse-widget-shell/widgets"

/**
 * The engine part of the meta line (U7) from the result's echo; `null` for an unscoped result,
 * which names no engines.
 */
export function enginesMeta(
  engines: readonly string[] | null | undefined,
  reporting?: readonly string[],
): ViewMetaEngines | null {
  if (!engines || engines.length === 0) return null
  return {
    count: engines.length,
    silent: reporting ? engines.filter((id) => !reporting.includes(id)).length : null,
  }
}
