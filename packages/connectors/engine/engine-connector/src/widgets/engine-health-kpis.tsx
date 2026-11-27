import { KpiGrid, formatCount, formatNumber } from "@miragon/pulse-ui"
import type { EngineHealthData } from "../view-models.js"
import type { OnNavigate } from "./navigation.js"
import { AlarmCount } from "./lib/alarm-count.js"
import { useT } from "../messages/use-t.js"

/**
 * The open incidents' label: the processes' alone, which the tile counts, once the engine holds
 * root incidents outside any process too, which the line under the bar counts apart (never summed
 * into the tile: "0 open incidents in processes" beside "1 incident outside any process").
 */
function incidentsLabel(summary: EngineHealthData["summary"]) {
  return (summary.outsideAnyProcess?.count ?? 0) > 0
    ? "engineHealth.kpiOpenIncidentsInProcesses"
    : "engineHealth.kpiOpenIncidents"
}

/**
 * Only open incidents carry a state; the other KPIs are neutral counts (#322 U14). The incidents
 * are open root incidents: a failure that runs through a chain of called instances counts once.
 */
export function HealthKpis({
  summary,
  go,
}: {
  summary: EngineHealthData["summary"]
  go: OnNavigate
}) {
  const t = useT()
  return (
    <KpiGrid
      boxed
      ariaLabel={t("engineHealth.kpiHealth")}
      cells={[
        {
          label: t("engineHealth.kpiRunningInstances"),
          value: formatNumber(summary.runningInstances),
          // The KPI counts instances, so the drill lands on instances, not definitions.
          onClick: () => go({ type: "process-instances" }),
          // Named by its visible label and value (WCAG 2.5.3); the hint
          // says what the click does.
          actionHint: t("engineHealth.kpiRunningInstancesAria"),
        },
        {
          label: t(incidentsLabel(summary)),
          // The derivative beats the absolute during an active incident: "9 new in the last hour"
          // = burning now; unknown (the scan does not reach back an hour) says nothing.
          value: (
            <AlarmCount alarm={summary.totalIncidents > 0 && "openIncidents"}>
              {formatNumber(summary.totalIncidents)}
            </AlarmCount>
          ),
          fraction:
            summary.lastHourIncidents !== null && summary.lastHourIncidents > 0
              ? ` ${t("engineHealth.kpiInLastHour", { count: formatNumber(summary.lastHourIncidents) })}`
              : undefined,
          onClick: () => go({ type: "incidents" }),
          actionHint: t("engineHealth.kpiOpenIncidentsAria"),
        },
        {
          label: t("engineHealth.kpiAffectedActivities"),
          // null (the incident scan was capped) shows "—", never a guessed count.
          value: formatCount(summary.affectedActivities),
        },
        // The deployed count is the processes section's, never a denominator here (D12).
        {
          label: t("engineHealth.kpiAffectedProcesses"),
          value: formatNumber(summary.affectedDefinitions),
        },
      ]}
    />
  )
}

/**
 * Shows the engine moving work even with zero incidents, started then completed in the last 24 h,
 * an unread one as "—". Where the engine is known to write no history (`historyRecorded` false),
 * the line says so instead of "0 · 0"; it is hidden when neither count was read.
 */
export function Throughput24h({ summary }: { summary: EngineHealthData["summary"] }) {
  const t = useT()
  if (summary.historyRecorded === false) {
    return (
      <p className="text-muted-foreground text-small">{t("engineHealth.throughput24hNoHistory")}</p>
    )
  }
  if (summary.started24h === null && summary.completed24h === null) return null
  return (
    <p className="text-muted-foreground text-small">
      {t("engineHealth.throughput24h")}{" "}
      <span className="tabular-nums">
        {formatCount(summary.started24h)} · {formatCount(summary.completed24h)}
      </span>
    </p>
  )
}
