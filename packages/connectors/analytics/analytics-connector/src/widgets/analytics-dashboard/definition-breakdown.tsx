import {
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
import { useDashboardSelfFetch, type DashboardScopeProps, type DashboardView } from "./lib.js"
import { QueryGate } from "../query-gate.js"
import { useT, type T } from "../../messages/use-t.js"
import { processNameOf } from "../../bpmn-names.js"
import { Figure, FigureLegend } from "../figure.js"

/** No tone on any count: all are volumes or live counts without a state (U14). */
function columns(t: T): ListTableColumn[] {
  return [
    { label: t("aDefBreakdown.colProcess") },
    { label: t("aDefBreakdown.colStarted"), align: "right" },
    { label: t("aDefBreakdown.colCompleted"), align: "right" },
    { label: t("aDefBreakdown.colRunningNow"), align: "right" },
    { label: t("aDefBreakdown.colIncidents"), align: "right" },
    { label: t("aDefBreakdown.colAvgDuration"), align: "right", hideBelow: "sm" },
  ]
}

export function ProcessDefinitionBreakdown({
  data: initialData,
  processDefinitionKey,
  period,
  engine,
}: { data: DashboardView | null } & DashboardScopeProps) {
  const t = useT()
  const fallbackQuery = useDashboardSelfFetch(initialData, { processDefinitionKey, period, engine })

  return (
    <QueryGate initialData={initialData} query={fallbackQuery} skeleton={<TableSkeleton />}>
      {(data) =>
        data.definitionBreakdown.length === 0 ? (
          <WidgetShell>
            <TableEmptyState description={t("aDefBreakdown.emptyHint")}>
              {t("aDefBreakdown.emptyState")}
            </TableEmptyState>
          </WidgetShell>
        ) : (
          <WidgetShell>
            <Section
              title={t("aDefBreakdown.heading")}
              count={data.definitionBreakdown.length}
              defaultOpen
            >
              <ListTable ariaLabel={t("aDefBreakdown.tableLabel")} columns={columns(t)}>
                {data.definitionBreakdown.map((def) => (
                  <tr key={def.processDefinitionKey}>
                    <Td>
                      <NamedId
                        name={processNameOf(data.names, def.processDefinitionKey)}
                        id={def.processDefinitionKey}
                      />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatNumber(def.totalInstances)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatNumber(def.completed)}
                    </Td>
                    {/* Not reported (no engine in scope sends its gauges): "—", never 0. */}
                    <Td align="right" className="tabular-nums">
                      <Figure value={def.runningNow} why={t("aFigure.notReported")} />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatNumber(def.incidentsCreated)}
                    </Td>
                    <Td align="right" className="whitespace-nowrap tabular-nums">
                      <Figure
                        value={def.avgDurationMs}
                        format={formatDuration}
                        why={t("aFigure.nothingEnded")}
                      />
                    </Td>
                  </tr>
                ))}
              </ListTable>
              <FigureLegend
                reasons={[
                  data.definitionBreakdown.some((d) => d.runningNow === null) &&
                    t("aFigure.notReported"),
                  data.definitionBreakdown.some((d) => d.avgDurationMs === null) &&
                    t("aFigure.nothingEnded"),
                ]}
              />
            </Section>
          </WidgetShell>
        )
      }
    </QueryGate>
  )
}
