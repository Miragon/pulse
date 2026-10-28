import {
  HandOffButton,
  ListTable,
  NamedId,
  Section,
  TableEmptyState,
  TableSkeleton,
  Td,
  WidgetShell,
  formatDuration,
  formatNumber,
  type ListTableColumn,
} from "@miragon/pulse-widget-shell/widgets"
import type { AnalyticsDashboardData } from "@miragon/pulse-analytics-client"
import { useDashboardSelfFetch, type DashboardScopeProps, type DashboardView } from "./lib.js"
import { QueryGate } from "../query-gate.js"
import { useT, type T } from "../../messages/use-t.js"
import { engineIdsOf, useHandOff, type HandOff } from "../hand-off.js"
import { elementNameOf, processNameOf } from "../../bpmn-names.js"
import { activityTypeLabel } from "../names.js"
import { Figure, FigureLegend } from "../figure.js"

type ActivityRow = AnalyticsDashboardData["activityBreakdown"][number]

/**
 * Over the scope of the data on screen (its `engines` and `period` echo), so the follow-up reads
 * exactly the numbers shown.
 */
export function activityBottleneckHandOff(
  act: ActivityRow,
  data: Pick<AnalyticsDashboardData, "engines" | "period">,
): HandOff {
  return {
    intent: "askAi.activityBottleneck",
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: act.processDefinitionKey,
      period: data.period,
    },
    // Durations are null when nothing ended in the window — left out, never 0.
    facts: {
      activityId: act.activityId,
      activityType: act.activityType,
      executionCount: act.executionCount,
      avgDurationMs: act.avgDurationMs,
      p95DurationMs: act.p95DurationMs,
      totalTimeMs: act.totalTimeMs,
    },
    tools: ["analytics_element_bottleneck", "analytics_analyze_process_performance"],
  }
}

/**
 * Columns by priority (U2); the duration columns give way only below 640 px, so the 760 px inline
 * view shows every one.
 */
function columns(t: T): ListTableColumn[] {
  return [
    { label: t("aBottleneck.colActivity") },
    { label: t("aBottleneck.colTotalTime"), align: "right", sort: "descending" },
    { label: t("aBottleneck.colExecutions"), align: "right" },
    { label: t("aBottleneck.colAvg"), align: "right", hideBelow: "sm" },
    { label: t("aBottleneck.colP95"), align: "right", hideBelow: "sm" },
    { plain: true, sticky: true },
  ]
}

/**
 * BPMN ids are unique only within one model, so the same id in two processes is two rows, the
 * second line naming the process.
 */
export function ActivityBottleneckTable({
  data: initialData,
  processDefinitionKey,
  period,
  engine,
}: { data: DashboardView | null } & DashboardScopeProps) {
  const t = useT()
  const { ask } = useHandOff()
  const fallbackQuery = useDashboardSelfFetch(initialData, { processDefinitionKey, period, engine })

  return (
    <QueryGate initialData={initialData} query={fallbackQuery} skeleton={<TableSkeleton />}>
      {(data) => {
        const rows = data.activityBreakdown
        if (rows.length === 0) {
          return (
            <WidgetShell>
              <TableEmptyState description={t("aBottleneck.emptyHint")}>
                {t("aBottleneck.emptyState")}
              </TableEmptyState>
            </WidgetShell>
          )
        }
        const cut = data.activityCount > rows.length
        const fleet = data.processDefinitionKey === null
        return (
          <WidgetShell>
            <Section
              title={
                cut
                  ? t("aBottleneck.headingTop", { count: formatNumber(rows.length) })
                  : t("aBottleneck.heading")
              }
              count={cut ? undefined : rows.length}
              defaultOpen
            >
              {cut && (
                <p className="text-muted-foreground text-small mb-2">
                  {t("aBottleneck.topNote", {
                    count: formatNumber(rows.length),
                    total: formatNumber(data.activityCount),
                  })}
                </p>
              )}
              <ListTable ariaLabel={t("aBottleneck.tableLabel")} columns={columns(t)}>
                {rows.map((act) => (
                  <tr key={`${act.processDefinitionKey}:${act.activityId}`}>
                    <Td>
                      <NamedId
                        name={elementNameOf(data.names, act.processDefinitionKey, act.activityId)}
                        id={act.activityId}
                        detail={[
                          activityTypeLabel(t, act.activityType),
                          fleet
                            ? (processNameOf(data.names, act.processDefinitionKey) ??
                              act.processDefinitionKey)
                            : null,
                        ]}
                      />
                    </Td>
                    <Td align="right" className="font-medium whitespace-nowrap tabular-nums">
                      {formatDuration(act.totalTimeMs)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatNumber(act.executionCount)}
                    </Td>
                    <Td align="right" className="whitespace-nowrap tabular-nums">
                      <Figure
                        value={act.avgDurationMs}
                        format={formatDuration}
                        why={t("aFigure.nothingEnded")}
                      />
                    </Td>
                    <Td align="right" className="whitespace-nowrap tabular-nums">
                      <Figure
                        value={act.p95DurationMs}
                        format={formatDuration}
                        why={t("aFigure.nothingEnded")}
                      />
                    </Td>
                    <Td align="right">
                      <HandOffButton
                        action="explainBottleneck"
                        variant="icon"
                        prompt={ask(activityBottleneckHandOff(act, data))}
                      />
                    </Td>
                  </tr>
                ))}
              </ListTable>
              <FigureLegend
                reasons={[
                  rows.some((a) => a.avgDurationMs === null || a.p95DurationMs === null) &&
                    t("aFigure.nothingEnded"),
                ]}
              />
            </Section>
          </WidgetShell>
        )
      }}
    </QueryGate>
  )
}
