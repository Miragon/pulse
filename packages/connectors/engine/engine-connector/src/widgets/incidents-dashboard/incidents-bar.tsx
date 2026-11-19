import { formatNumber, StateLabel, WidgetHeader } from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  HandOffButton,
  ViewDataState,
  WidgetShell,
  useViewData,
} from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardData } from "../../view-models.js"
import { ENGINE_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff } from "../lib/hand-off.js"
import { useT, type T } from "../../messages/use-t.js"
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

/**
 * The open incidents in one sentence: how many, in how many processes and, where every card's
 * breakdown is complete, at how many activities ("101 open in 2 processes, 3 activities").
 */
function openSummary(t: T, data: IncidentsDashboardData): string {
  const count = formatNumber(data.totalCount)
  const processes = formatNumber(data.processCount)
  return data.affectedActivityCount === null
    ? t("incidentsKpi.openSummary", { count, processes })
    : t("incidentsKpi.openSummaryActivities", {
        count,
        processes,
        activities: formatNumber(data.affectedActivityCount),
      })
}

/**
 * The incidents route's bar, a view of its own over the list's feed (one query, shared): the
 * engine in its title, the open incidents in words, its one action the hand-off and, at its end,
 * when the numbers were read. No tiles: the segments under it count All and New in 24h, the cards
 * their processes. Loading or failed, it says so once for the route, with the Try again that reads
 * the feed for the list too.
 */
export function IncidentsBar({
  data: initialData = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine: string
}) {
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
  const handOffs = useHandOffsShown()
  // The engine in the title (#322 U4).
  const title = t("incidentsKpi.titleFor", { engine })

  // Loading or failed, the route keeps its title, the page's one heading.
  if (!data) {
    return (
      <WidgetShell header={<WidgetHeader title={title} />}>
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

  const summary = openSummary(t, data)
  return (
    <WidgetShell
      header={
        <WidgetHeader
          title={title}
          sub={
            // A count in the header is a state label (invariant 6): the incident's icon carries
            // the alarm, the number stays in the foreground.
            data.totalCount > 0 ? (
              <StateLabel state="incident">{summary}</StateLabel>
            ) : (
              <span>{summary}</span>
            )
          }
          actions={
            // Its one action is a hand-off: where the host hides it, the bar has no group.
            handOffs && (
              <HandOffButton
                action="assess"
                variant="toolbar"
                prompt={ask(triageIncidentsHandOff(data, engine))}
              />
            )
          }
          freshness={<FreshnessStamp at={data.fetchedAt} />}
        />
      }
    />
  )
}
