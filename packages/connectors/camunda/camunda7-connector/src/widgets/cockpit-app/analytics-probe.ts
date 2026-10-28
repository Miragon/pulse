import { useToolQuery } from "@miragon/mcp-toolkit-ui"

/** Tier-2 raw name; reads only the profile store, so it answers independent of Prometheus and toolset. */
const ANALYTICS_PROBE_TOOL = "analytics_settings_data"

/**
 * Widgets sit in the bundle regardless, so only a runtime call can tell. False until answered,
 * so the gated view never vanishes under the cursor; the key avoids the prefixes Refresh re-reads.
 */
export function useAnalyticsActive(): boolean {
  return useToolQuery(["analytics-probe"], ANALYTICS_PROBE_TOOL, {}).isSuccess
}
