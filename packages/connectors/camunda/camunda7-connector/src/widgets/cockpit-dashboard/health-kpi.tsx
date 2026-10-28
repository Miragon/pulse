import {
  HandOffButton,
  ViewDataState,
  WidgetShell,
  formatNumber,
} from "@miragon/pulse-widget-shell/widgets"
import { KpiGrid, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import { useViewData } from "@miragon/mcp-toolkit-ui/hooks"
import type { CockpitDashboardData } from "../../view-models.js"
import { buildRows } from "./lib.js"
import { useNav } from "../navigation.js"
import { CAMUNDA7_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT } from "../../messages/use-t.js"

export function triageLandscapeHandOff(
  data: CockpitDashboardData,
  engine: string | undefined,
): HandOff {
  const { summary } = data
  return {
    intent: "askAi.landscape.triage",
    ids: { engine },
    // Every count over all versions of the key (#335).
    facts: {
      definitionKeys: summary.totalDefinitions,
      runningInstances: summary.totalRunningInstances,
      failedJobs: summary.totalFailedJobs,
      openIncidents: summary.totalIncidents,
    },
    tools: [
      "analytics_engine_health",
      "analytics_show_failure_dashboard",
      "camunda7_show_engine_health",
      "camunda7_list_incidents",
    ],
  }
}

/** Standalone gets `data`; in the cockpit it self-fetches, deduped with the definitions table. */
export function ProcessHealthKpiView({
  data: initialData = null,
  engine,
}: {
  data?: CockpitDashboardData | null
  engine?: string
}) {
  const go = useNav()
  const feedEngine = engine ?? initialData?.engineId
  const { data, loading, error, refetch } = useViewData<CockpitDashboardData>(
    initialData,
    ["camunda7:cockpit-overview", feedEngine ?? null],
    CAMUNDA7_COCKPIT_OVERVIEW_DATA,
    { engine: feedEngine },
    !!feedEngine,
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
        loadingText={t("cockpitHealth.loading")}
        emptyText={t("cockpitHealth.noData")}
      />
    )
  }

  const { summary } = data
  const rows = buildRows(data)
  const healthyCount = rows.filter((r) => r.tone === "success").length
  const affectedCount = rows.filter((r) => r.tone === "danger" || r.tone === "warning").length

  return (
    <>
      <WidgetHeader
        title={t("cockpitHealth.title")}
        sub={
          <span>
            {t("cockpitHealth.subSummary", { count: formatNumber(summary.totalDefinitions) })}
          </span>
        }
        actions={
          <HandOffButton
            action="assess"
            prompt={ask(triageLandscapeHandOff(data, engine ?? data.engineId))}
          />
        }
      />
      <KpiGrid
        boxed
        header={{
          label: t("cockpitHealth.gridLabel"),
          badge: t("cockpitHealth.gridBadge"),
        }}
        cells={[
          {
            label: t("cockpitHealth.cellTotalProcesses"),
            value: formatNumber(summary.totalDefinitions),
            onClick: () => go({ type: "process-list" }),
            // WCAG 2.5.3: named by its visible label and value.
            actionHint: t("cockpitHealth.cellTotalProcessesAria"),
          },
          {
            label: t("cockpitHealth.cellHealthy"),
            value: formatNumber(healthyCount),
            fraction: ` /${formatNumber(summary.totalDefinitions)}`,
            tone: healthyCount > 0 ? "success" : undefined,
          },
          {
            label: t("cockpitHealth.cellAffected"),
            value: formatNumber(affectedCount),
            fraction: ` /${formatNumber(summary.totalDefinitions)}`,
            tone: affectedCount > 0 ? "danger" : undefined,
          },
          {
            label: t("cockpitHealth.cellOpenIncidents"),
            value: formatNumber(summary.totalIncidents),
            tone: summary.totalIncidents > 0 ? "danger" : undefined,
            onClick: () => go({ type: "incidents" }),
            actionHint: t("cockpitHealth.cellOpenIncidentsAria"),
          },
        ]}
      />
    </>
  )
}

export function ProcessHealthKpi({
  data,
  engine,
}: {
  data: CockpitDashboardData | null
  engine?: string
}) {
  return (
    <WidgetShell>
      <ProcessHealthKpiView data={data} engine={engine} />
    </WidgetShell>
  )
}
