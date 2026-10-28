import {
  HandOffButton,
  ViewDataState,
  WidgetShell,
  formatNumber,
  formatTimestamp,
} from "@miragon/pulse-widget-shell/widgets"
import { KpiGrid, LivePill, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import { useViewData } from "@miragon/mcp-toolkit-ui/hooks"
import type { IncidentsDashboardData } from "../../view-models.js"
import { CAMUNDA7_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { useT } from "../../messages/use-t.js"
import { formatCount } from "../lib/format-count.js"
import { dashboardScope, incidentsFeed } from "./scope.js"

/** A filtered total is stated as the matching incidents; a plan, nothing changed yet. */
export function triageIncidentsHandOff(
  data: IncidentsDashboardData,
  engine: string | undefined,
): HandOff {
  const scope = dashboardScope(data.filters)
  return {
    intent: scope.filtered ? "askAi.incidents.triageFiltered" : "askAi.incidents.triage",
    ids: {
      engine,
      processDefinitionKey: scope.processDefinitionKey,
      incidentType: scope.incidentType,
    },
    facts: {
      openIncidents: scope.filtered ? undefined : data.totalCount,
      matchingIncidents: scope.filtered ? data.totalCount : undefined,
      processes: data.processCount,
      affectedActivities: data.affectedActivityCount,
      last24h: data.last24hCount,
      latestIncident: data.latestIncident,
    },
    tools: [
      "camunda7_list_incidents",
      "camunda7_query_historic_incidents",
      "camunda7_query_historic_activity_instances",
      "camunda7_show_cluster_detail",
    ],
  }
}

export function IncidentOverviewKpiView({
  data: initialData = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine?: string
}) {
  // Shares the process-list feed, so both panels dedupe to one fetch.
  const feed = incidentsFeed(engine)
  const { data, loading, error, refetch } = useViewData<IncidentsDashboardData>(
    initialData,
    feed.key,
    CAMUNDA7_INCIDENTS_DATA,
    feed.args,
    feed.ready,
    { initialDataMode: "seed" },
  )
  const t = useT()
  const { ask } = useHandOff()

  if (!data) {
    return (
      <ViewDataState
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingText={t("incidentsKpi.loading")}
        emptyText={t("incidentsKpi.noData")}
      />
    )
  }

  const engineId = engine ?? data.engineId
  return (
    <>
      <WidgetHeader
        // The engine in the title (#322 U4).
        title={
          engineId ? t("incidentsKpi.titleFor", { engine: engineId }) : t("incidentsKpi.title")
        }
        sub={
          <>
            <EngineMeta engineId={engineId} />
            <LivePill>{t("incidentsKpi.live")}</LivePill>
            <span>
              {t("incidentsKpi.openSummary", {
                count: formatNumber(data.totalCount),
                processes: formatNumber(data.processCount),
              })}
              {data.latestIncident && (
                <>
                  {" "}
                  {t("incidentsKpi.lastEvent", {
                    time: formatTimestamp(data.latestIncident),
                  })}
                </>
              )}
            </span>
          </>
        }
        actions={
          <HandOffButton action="assess" prompt={ask(triageIncidentsHandOff(data, engineId))} />
        }
      />
      {/* Only the open incidents carry a state (#322 U14); the rest are counts. */}
      <KpiGrid
        boxed
        ariaLabel={t("incidentsKpi.overviewLabel")}
        cells={[
          {
            label: t("incidentsKpi.cellOpenIncidents"),
            value: formatNumber(data.totalCount),
            tone: data.totalCount > 0 ? "danger" : undefined,
          },
          {
            label: t("incidentsKpi.cellProcessesAffected"),
            value: formatNumber(data.processCount),
          },
          {
            label: t("incidentsKpi.cellActivitiesAffected"),
            value: formatCount(data.affectedActivityCount),
          },
          {
            label: t("incidentsKpi.cellLast24h"),
            value: `+${formatNumber(data.last24hCount)}`,
          },
        ]}
      />
    </>
  )
}

export function IncidentOverviewKpi({
  data,
  engine,
}: {
  data: IncidentsDashboardData | null
  engine?: string
}) {
  return (
    <WidgetShell>
      <IncidentOverviewKpiView data={data} engine={engine} />
    </WidgetShell>
  )
}
