import { formatNumber, KpiGrid, type KpiCell } from "@miragon/pulse-ui"
import { ViewDataState, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { AlarmCount } from "../lib/alarm-count.js"
import { useNav } from "../navigation.js"
import { useT } from "../../messages/use-t.js"
import { diagramActivityFraction } from "./activity-scope.js"
import { useDefinitionData, type DefinitionScope } from "./feed.js"

export function ProcessDefinitionKpi(scope: DefinitionScope) {
  const t = useT()
  const go = useNav()
  const { data, loading, error, refetch } = useDefinitionData(scope)

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
  // The diagram's affected activities, one tile and no denominator (D6, D12); the activities only
  // older versions have are named under it, never folded in.
  const activitiesCell: KpiCell = fraction
    ? {
        label: t("engineHealth.kpiAffectedActivities"),
        value: formatNumber(fraction.affected),
        trend:
          fraction.olderVersionsOnly > 0
            ? t("procIncKpi.olderVersionsOnly", { count: formatNumber(fraction.olderVersionsOnly) })
            : undefined,
      }
    : {
        label: t("engineHealth.kpiAffectedActivities"),
        value: formatNumber(data.activities.length),
      }

  // #322 U14: counts stay neutral, never a green or red digit or a tinted tile; open incidents and
  // jobs without retries alarm by their icon and words.
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
      value: (
        <AlarmCount alarm={data.incidentCount > 0 && "openIncidents"}>
          {formatNumber(data.incidentCount)}
        </AlarmCount>
      ),
    },
    // New incidents, never a balance: no plus, since resolved ones are not subtracted (D11).
    {
      label: t("engineHealth.new24h"),
      value: formatNumber(data.last24hCount),
    },
    {
      label: t("procIncKpi.failedJobs"),
      value: (
        <AlarmCount alarm={data.failedJobs > 0 && "jobsWithoutRetries"}>
          {formatNumber(data.failedJobs)}
        </AlarmCount>
      ),
      // The drill shows what the cell counts: this process's jobs without retries.
      onClick: () =>
        go({ type: "jobs", processDefinitionKey: data.processDefinitionKey, failedOnly: true }),
      actionHint: t("procIncKpi.failedJobsAria", { name: title }),
    },
    activitiesCell,
  ]

  // No header of its own: the bar above names the process and the version scope of its counts.
  return (
    <WidgetShell>
      <KpiGrid boxed ariaLabel={t("procIncKpi.overview")} cells={cells} />
    </WidgetShell>
  )
}
