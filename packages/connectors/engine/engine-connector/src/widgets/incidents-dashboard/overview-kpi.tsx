import {
  formatCount,
  formatNumber,
  formatTimestamp,
  KpiGrid,
  LivePill,
  WidgetHeader,
} from "@miragon/pulse-ui"
import {
  HandOffButton,
  ViewDataState,
  WidgetShell,
  useViewData,
} from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardData } from "../../view-models.js"
import { ENGINE_INCIDENTS_DATA } from "../../tool-names.js"
import { AlarmCount } from "../lib/alarm-count.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT } from "../../messages/use-t.js"
import { dashboardScope, incidentsFeed } from "./scope.js"

/** A filtered total is stated as the matching incidents; a plan, nothing changed yet. */
function triageIncidentsHandOff(data: IncidentsDashboardData, engine: string): HandOff {
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
  }
}

function IncidentOverviewKpiView({
  data: initialData = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine: string
}) {
  // Shares the process-list feed, so both panels dedupe to one fetch.
  const feed = incidentsFeed(engine)
  const { data, loading, error, refetch } = useViewData<IncidentsDashboardData>(
    initialData,
    feed.key,
    ENGINE_INCIDENTS_DATA,
    feed.args,
    true,
  )
  const t = useT()
  const { ask } = useHandOff()

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          onRetry={refetch}
          loadingText={t("incidentsKpi.loading")}
          emptyText={t("incidentsKpi.noData")}
        />
      </WidgetShell>
    )
  }

  return (
    <WidgetShell
      header={
        <WidgetHeader
          // The engine in the title (#322 U4).
          title={t("incidentsKpi.titleFor", { engine })}
          sub={
            <>
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
            <HandOffButton
              action="assess"
              variant="toolbar"
              prompt={ask(triageIncidentsHandOff(data, engine))}
            />
          }
        />
      }
    >
      {/* Only the open incidents alarm, by their icon and words (#322 U14); every number stays
          neutral, no tile tinted. */}
      <KpiGrid
        boxed
        ariaLabel={t("incidentsKpi.overviewLabel")}
        cells={[
          {
            label: t("incidentsKpi.cellOpenIncidents"),
            value: (
              <AlarmCount alarm={data.totalCount > 0 && "openIncidents"}>
                {formatNumber(data.totalCount)}
              </AlarmCount>
            ),
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
    </WidgetShell>
  )
}

/** The incidents route's view of its own: its bar and the KPIs. */
export function IncidentOverviewKpi({
  data,
  engine,
}: {
  data: IncidentsDashboardData | null
  engine: string
}) {
  return <IncidentOverviewKpiView data={data} engine={engine} />
}
