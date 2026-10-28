import type { MCPServer } from "mcp-use"
import type { CompareKpiDelta, PrometheusClient } from "@miragon/pulse-analytics-client"
import type { ProfileSource, ServerT } from "../server-locale.js"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import type { NameLookup } from "../bpmn-name-lookup.js"

/**
 * The `_meta`/view bindings are not passed: each registration spreads `showToolBinding()`/`appOnly`
 * itself, keeping the dual-protocol contract in one place.
 */
export interface AnalyticsWidgetToolsContext {
  server: MCPServer
  ch: PrometheusClient
  /** The server's configured engine ids — every query resolves `engine` through it. */
  engineScope: AnalyticsEngineScope
  /** Locale for model-facing summaries plus the saved analytics defaults. */
  profileStore?: ProfileSource
  /** The process names behind the ids a view lists (`bpmn-name-lookup.ts`); absent → ids. */
  namesFor?: NameLookup
}

/** Formats a nullable comparison delta ("+12.5%", "-3pp", "n/a") for summaries. */
function fmtDelta(value: number | null, unit: string): string {
  if (value == null) return "n/a"
  return `${value > 0 ? "+" : ""}${value}${unit}`
}

/** A null delta reads "n/a" (a side unmeasured or a 0 baseline), never −100 %. */
export function compareDeltaSummary(delta: CompareKpiDelta): string {
  return [
    `starts/day ${fmtDelta(delta.started_per_day_delta_pct, "%")}`,
    `incident rate ${fmtDelta(delta.incident_rate_delta_pp, "pp")}`,
    ...(delta.element_incident_rate_delta_pp === null
      ? []
      : [`element incident rate ${fmtDelta(delta.element_incident_rate_delta_pp, "pp")}`]),
    `avg duration ${fmtDelta(delta.avg_duration_delta_pct, "%")}`,
    `p95 ${fmtDelta(delta.p95_duration_delta_pct, "%")}`,
  ].join(", ")
}

export const suppressedNote = (suppressed: boolean) =>
  suppressed ? "; flagged suppressed (sample below minBucketSize)" : ""

/**
 * One engine by name, or every engine a fleet aggregate adds up, so a fleet figure never reads as
 * one engine's.
 */
export function engineScopeSummary(
  t: ServerT,
  engines: readonly string[] | null,
  fleet: boolean,
): string {
  if (!engines || engines.length === 0) return ""
  const ids = engines.map((id) => `"${id}"`).join(", ")
  if (fleet) return t("aSum.engineScopeFleet", { count: engines.length, ids })
  return engines.length === 1
    ? t("aSum.engineScopeOne", { id: engines[0] })
    : t("aSum.engineScopeSubset", { ids })
}
