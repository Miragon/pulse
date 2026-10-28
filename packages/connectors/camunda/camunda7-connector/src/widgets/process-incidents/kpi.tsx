import { ViewDataState, WidgetShell, formatNumber } from "@miragon/pulse-widget-shell/widgets"
import { KpiGrid, type KpiCell } from "@miragon/mcp-toolkit-ui"
import type { ProcessIncidentsData } from "../../view-models.js"
import { useNav } from "../navigation.js"
import { useT } from "../../messages/use-t.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData } from "./feed.js"

export function ProcessDefinitionKpi({
  data: initialData = null,
  processDefinitionKey,
  engine,
}: {
  data?: ProcessIncidentsData | null
  processDefinitionKey?: string
  engine?: string
}) {
  const t = useT()
  const go = useNav()
  const { data, loading, error, refetch } = useDefinitionData(
    initialData,
    processDefinitionKey,
    engine,
  )

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          loadingText={t("procIncKpi.loading")}
          emptyText={t("procIncKpi.noData")}
          onRetry={refetch}
          retryLabel={t("viewState.retry")}
        />
      </WidgetShell>
    )
  }

  const title = data.processDefinitionName ?? data.processDefinitionKey
  const fraction = diagramActivityFraction(data)
  // Activities only older versions have are named beside the fraction, never folded in.
  const activitiesCell: KpiCell = fraction
    ? {
        label: t("procIncKpi.activitiesAffected"),
        value: formatNumber(fraction.affected),
        fraction: `/${formatNumber(fraction.total)}`,
        trend:
          fraction.olderVersionsOnly > 0
            ? t("procIncKpi.olderVersionsOnly", { count: formatNumber(fraction.olderVersionsOnly) })
            : undefined,
      }
    : { label: t("procIncKpi.activitiesAffected"), value: formatNumber(data.activities.length) }

  // #322 U14: counts stay neutral, never a green or red digit.
  const cells: KpiCell[] = [
    {
      label: t("procIncKpi.running"),
      value: formatNumber(data.runningInstances),
      onClick: () =>
        go({ type: "process-instances", processDefinitionKey: data.processDefinitionKey }),
      // WCAG 2.5.3: named by its visible label and value.
      actionHint: t("procIncKpi.runningAria", { name: title }),
    },
    {
      label: t("procIncKpi.openIncidents"),
      value: formatNumber(data.incidentCount),
      tone: data.incidentCount > 0 ? "danger" : undefined,
    },
    {
      label: t("procIncKpi.last24h"),
      value: `+${formatNumber(data.last24hCount)}`,
    },
    {
      label: t("procIncKpi.failedJobs"),
      value: formatNumber(data.failedJobs),
      tone: data.failedJobs > 0 ? "danger" : undefined,
    },
    activitiesCell,
  ]

  return (
    <WidgetShell>
      <KpiGrid
        boxed
        header={{ label: t("procIncKpi.overview"), badge: t("procIncKpi.headerBadge") }}
        cells={cells}
      />
    </WidgetShell>
  )
}
