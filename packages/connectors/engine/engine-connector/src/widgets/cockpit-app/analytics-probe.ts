import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"

/**
 * A raw cross-module name: analytics' only argument-free feed. One landscape read (a few PromQL
 * instant queries plus name lookups); while Prometheus is down it fails, so the analytics offers
 * hide (fail-closed).
 */
const ANALYTICS_PROBE_TOOL = "analytics_engine_landscape_data"

/** Never stale and never retried on mount: one answer per view document, success or failure. */
const ONCE_PER_VIEW = { staleTime: Infinity, retryOnMount: false } as const

/**
 * Widgets sit in the bundle regardless, so only a runtime call can tell. False until answered,
 * and the answer never flips under the cursor; the key avoids the prefixes Refresh re-reads.
 */
export function useAnalyticsActive(): boolean {
  return (
    useToolQuery(["analytics-probe"], ANALYTICS_PROBE_TOOL, {}, ONCE_PER_VIEW).data !== undefined
  )
}
