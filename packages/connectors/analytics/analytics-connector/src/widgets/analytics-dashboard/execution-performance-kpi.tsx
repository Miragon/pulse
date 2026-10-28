import { WidgetShell, formatDuration, formatNumber } from "@miragon/pulse-widget-shell/widgets"
import { KpiGrid, KpiGridSkeleton, type KpiCell } from "@miragon/mcp-toolkit-ui"
import { useDashboardSelfFetch, type DashboardScopeProps, type DashboardView } from "./lib.js"
import { QueryGate } from "../query-gate.js"
import { useT, type T } from "../../messages/use-t.js"
import { RATE_UP_IS_WORSE, deltaVerdict, type DeltaVerdict } from "../comparison-shared.js"

/** No %: a rate may pass 100. */
const rate = (value: number | null) => formatNumber(value, { maximumFractionDigits: 1 })

const VERDICT_KEY: Record<DeltaVerdict, string> = {
  worse: "aComparison.deltaWorse",
  better: "aComparison.deltaBetter",
  notReliable: "aComparison.deltaNotReliable",
}

/**
 * U14/U17: a verdict only from the comparisons' threshold on, and only with the
 * process fixed: over a mix the rate moves with the mix (Simpson's paradox), so
 * an unscoped dashboard shows the previous rate without a verdict.
 */
export function incidentRateTrend(
  t: T,
  data: Pick<DashboardView, "incidentRatePct" | "previous" | "processDefinitionKey">,
): Pick<KpiCell, "trend" | "trendDirection" | "trendTone"> {
  const previous = data.previous
  if (!previous || data.incidentRatePct === null) return {}
  if (previous.incidentRatePct === null) return { trend: t("aExecPerf.previousNoStarts") }
  const value = rate(previous.incidentRatePct)
  if (!data.processDefinitionKey) return { trend: t("aExecPerf.previous", { value }) }
  const change = data.incidentRatePct - previous.incidentRatePct
  const verdict = deltaVerdict(change, RATE_UP_IS_WORSE, previous.suppressed)
  if (!verdict) {
    return {
      trend: t("aExecPerf.previous", { value }),
      trendDirection: "flat",
      trendTone: "neutral",
    }
  }
  return {
    trend: t("aExecPerf.previousJudged", { value, verdict: t(VERDICT_KEY[verdict]) }),
    trendDirection: change > 0 ? "up" : change < 0 ? "down" : "flat",
    trendTone: verdict === "worse" ? "danger" : verdict === "better" ? "success" : "neutral",
  }
}

export function ExecutionPerformanceKpi({
  data: initialData,
  processDefinitionKey,
  period,
  engine,
}: { data: DashboardView | null } & DashboardScopeProps) {
  const t = useT()
  const fallbackQuery = useDashboardSelfFetch(initialData, { processDefinitionKey, period, engine })

  return (
    <QueryGate
      initialData={initialData}
      query={fallbackQuery}
      skeleton={<KpiGridSkeleton cells={4} boxed />}
    >
      {(data) => (
        <WidgetShell>
          <KpiGrid
            boxed
            header={{ label: t("aExecPerf.headerLabel") }}
            cells={[
              { label: t("aExecPerf.avgDuration"), value: formatDuration(data.avgDurationMs) },
              { label: t("aExecPerf.median"), value: formatDuration(data.medianDurationMs) },
              { label: t("aExecPerf.p95"), value: formatDuration(data.p95DurationMs) },
              {
                label: t("aExecPerf.incidentRate"),
                // One instance may carry several incidents, so the rate can pass 100.
                value: rate(data.incidentRatePct),
                ...incidentRateTrend(t, data),
              },
            ]}
          />
        </WidgetShell>
      )}
    </QueryGate>
  )
}
