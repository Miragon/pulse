import { useToolQuery } from "@miragon/mcp-toolkit-ui"
import type { EngineFilterInput, FailureDashboardData } from "@miragon/pulse-analytics-client"
import type { Named } from "../../bpmn-names.js"
import { ANALYTICS_FAILURE_DASHBOARD_DATA } from "../../tool-names.js"

/** The failure payload the widgets read: the figures plus the process names behind their keys. */
export type FailureView = Named<FailureDashboardData>

/** The cell props every failure widget takes — the engine scope its self-fetch reads. */
export interface FailureScopeProps {
  /** Configured engine id(s); omitted = every configured engine (the feed resolves it). */
  engine?: EngineFilterInput
}

// Point-in-time, so no period scope; the engine scope sits in the args AND the cache key so an
// engine-scoped cell never reads a fleet-wide entry. Self-fetches the *_data feed: a show_* call
// from the iframe may render a second widget per refresh on some hosts.
export function useFailureDashboardSelfFetch(
  initialData: FailureView | null,
  { engine }: FailureScopeProps,
) {
  return useToolQuery<FailureView>(
    ["analytics:failure-dashboard", engine ?? null],
    ANALYTICS_FAILURE_DASHBOARD_DATA,
    engine === undefined ? {} : { engine },
    { enabled: !initialData },
  )
}
