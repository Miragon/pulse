import {
  HandOffButton,
  ViewMeta,
  WidgetShell,
  formatLookback,
  formatNumber,
} from "@miragon/pulse-widget-shell/widgets"
import type { AnalyticsDashboardData } from "@miragon/pulse-analytics-client"
import { KpiGrid, KpiGridSkeleton, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import { useDashboardSelfFetch, type DashboardScopeProps, type DashboardView } from "./lib.js"
import { QueryGate } from "../query-gate.js"
import { useT } from "../../messages/use-t.js"
import { engineIdsOf, useHandOff, type HandOff } from "../hand-off.js"
import { enginesMeta } from "../view-meta.js"
import { processNameOf } from "../../bpmn-names.js"

/**
 * Window flows (`…InWindow`: incidents, not failed instances) apart from the live `…Now` gauges; an
 * unmeasured figure is left out, never 0 (#336).
 */
export function executionSummaryHandOff(data: AnalyticsDashboardData): HandOff {
  return {
    intent: "askAi.executionSummary",
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey ?? undefined,
      period: data.period,
    },
    facts: {
      startedInWindow: data.totalCount,
      completedInWindow: data.completedCount,
      incidentsCreatedInWindow: data.incidentsCreated,
      incidentsResolvedInWindow: data.incidentsResolved,
      incidentRatePct: data.incidentRatePct,
      avgDurationMs: data.avgDurationMs,
      p95DurationMs: data.p95DurationMs,
      runningNow: data.runningNow,
      openIncidentsNow: data.openIncidentsNow,
    },
    tools: ["analytics_analyze_process_performance", "analytics_find_failed_instances"],
  }
}

export function ExecutionSummaryKpi({
  data: initialData,
  processDefinitionKey,
  period,
  engine,
}: { data: DashboardView | null } & DashboardScopeProps) {
  const fallbackQuery = useDashboardSelfFetch(initialData, { processDefinitionKey, period, engine })
  const t = useT()
  const { ask } = useHandOff()

  return (
    <QueryGate
      initialData={initialData}
      query={fallbackQuery}
      header={<WidgetHeader title={t("aExecSummary.title")} />}
      skeleton={<KpiGridSkeleton cells={5} boxed />}
    >
      {(data) => (
        <WidgetShell>
          <WidgetHeader
            title={t("aExecSummary.title")}
            sub={
              <ViewMeta
                subject={
                  data.processDefinitionKey &&
                  (processNameOf(data.names, data.processDefinitionKey) ??
                    data.processDefinitionKey)
                }
                period={formatLookback(data.period)}
                engines={enginesMeta(data.engines, data.reportingEngines)}
                asOf={data.asOf}
              />
            }
            actions={
              <HandOffButton
                action="assess"
                variant="primary"
                prompt={ask(executionSummaryHandOff(data))}
              />
            }
          />
          {/* Counts of what happened stay neutral (CI §3.3, U14): starts,
              completions, new incidents and what runs now are volumes. The
              one state is an incident open right now, its danger dot next to
              the label; the digit itself is never coloured. */}
          <KpiGrid
            boxed
            header={{ label: t("aExecSummary.headerExecutionSummary") }}
            cells={[
              { label: t("aExecSummary.cellStarted"), value: formatNumber(data.totalCount) },
              {
                label: t("aExecSummary.cellCompleted"),
                value: formatNumber(data.completedCount),
              },
              {
                label: t("aExecSummary.cellIncidentsCreated"),
                value: formatNumber(data.incidentsCreated),
              },
              {
                // A live gauge without a series is "not reported": formatNumber
                // renders it as an em-dash, never as a plausible 0.
                label: t("aExecSummary.cellRunningNow"),
                value: formatNumber(data.runningNow),
              },
              {
                label: t("aExecSummary.cellOpenIncidentsNow"),
                value: formatNumber(data.openIncidentsNow),
                tone: (data.openIncidentsNow ?? 0) > 0 ? "danger" : undefined,
              },
            ]}
          />
        </WidgetShell>
      )}
    </QueryGate>
  )
}
