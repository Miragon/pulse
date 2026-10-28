import {
  HandOffButton,
  ListTable,
  NamedId,
  Section,
  TableEmptyState,
  TableSkeleton,
  Td,
  WidgetShell,
  type ListTableColumn,
} from "@miragon/pulse-widget-shell/widgets"
import type { ErrorPatternItem, FailureDashboardData } from "@miragon/pulse-analytics-client"
import { useFailureDashboardSelfFetch, type FailureScopeProps, type FailureView } from "./lib.js"
import { QueryGate } from "../query-gate.js"
import { useT, type T } from "../../messages/use-t.js"
import { engineIdsOf, useHandOff, type HandOff } from "../hand-off.js"
import { processNameOf } from "../../bpmn-names.js"
import { StateCount } from "../figure.js"

/**
 * The gauge carries only incident type and process (#336), so the hand-off passes no field the data
 * cannot fill. A custom incident type is quoted as untrusted unless id-shaped.
 */
export function errorPatternHandOff(
  pattern: ErrorPatternItem,
  data: Pick<FailureDashboardData, "engines">,
): HandOff {
  return {
    intent: "askAi.errorPattern",
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: pattern.processDefinitionKey,
      incidentType: pattern.incidentType,
    },
    facts: { openIncidentsNow: pattern.incidentCount },
    tools: [
      "analytics_find_failed_instances",
      "camunda7_list_incidents",
      "camunda7_query_historic_incidents",
      "camunda7_query_historic_activity_instances",
    ],
  }
}

function columns(t: T): ListTableColumn[] {
  return [
    { label: t("aErrorPatterns.columnIncidentType") },
    { label: t("aErrorPatterns.columnProcess") },
    { label: t("aErrorPatterns.columnCount"), align: "right" },
    {
      label: <span className="sr-only">{t("aErrorPatterns.columnAi")}</span>,
      plain: true,
      sticky: true,
    },
  ]
}

export function ErrorPatternsTable({
  data: initialData,
  engine,
}: { data: FailureView | null } & FailureScopeProps) {
  const t = useT()
  const { ask } = useHandOff()
  const fallbackQuery = useFailureDashboardSelfFetch(initialData, { engine })
  return (
    <QueryGate initialData={initialData} query={fallbackQuery} skeleton={<TableSkeleton />}>
      {(data) => {
        if (data.errorPatterns.length === 0) {
          // Nothing open is "all clear", not missing data.
          return (
            <WidgetShell>
              {data.processBreakdown.length === 0 ? (
                <TableEmptyState variant="done" description={t("aErrorPatterns.emptyDescription")}>
                  {t("aErrorPatterns.emptyTitle")}
                </TableEmptyState>
              ) : (
                <TableEmptyState>{t("aErrorPatterns.emptyNoPatterns")}</TableEmptyState>
              )}
            </WidgetShell>
          )
        }

        return (
          <WidgetShell>
            <Section
              title={t("aErrorPatterns.heading")}
              count={data.errorPatterns.length}
              defaultOpen
            >
              <ListTable ariaLabel={t("aErrorPatterns.tableAriaLabel")} columns={columns(t)}>
                {data.errorPatterns.map((pattern) => (
                  <tr key={`${pattern.processDefinitionKey}:${pattern.incidentType}`}>
                    <Td className="font-mono break-all">{pattern.incidentType}</Td>
                    <Td>
                      <NamedId
                        name={processNameOf(data.names, pattern.processDefinitionKey)}
                        id={pattern.processDefinitionKey}
                      />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      <StateCount value={pattern.incidentCount} />
                    </Td>
                    <Td align="right">
                      <HandOffButton
                        action="findCause"
                        variant="icon"
                        prompt={ask(errorPatternHandOff(pattern, data))}
                      />
                    </Td>
                  </tr>
                ))}
              </ListTable>
            </Section>
          </WidgetShell>
        )
      }}
    </QueryGate>
  )
}
