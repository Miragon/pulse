import type { ReactNode } from "react"
import { CountFigure, formatCount, KpiGrid, KpiGridSkeleton, type KpiCell } from "@miragon/pulse-ui"
import type { Count } from "@miragon/pulse-ui/format"
import type { Situation } from "@miragon/pulse-ui/tones"
import { readKpis } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { SectionState } from "../temporary/section-state.tsx"

const ROW = "grid min-w-0 gap-4 lg:grid-cols-[5fr_2fr]"

/** Whether a count says there is at least one. */
function some(count: Count): boolean {
  if (count === null || count === undefined) return false
  return typeof count === "number" ? count > 0 : count.atLeast > 0
}

/**
 * A count as a tile's figure: neutral, and where it alarms (an open incident, a job without
 * retries) with its situation's icon of its own shape and its words, never a colour.
 */
function figure(count: Count, alarm?: { situation: Situation; label: string }): ReactNode {
  const text = formatCount(count)
  if (alarm === undefined || !some(count)) return <CountFigure>{text}</CountFigure>
  return (
    <CountFigure situation={alarm.situation} label={alarm.label}>
      {text}
    </CountFigure>
  )
}

/**
 * The tiles: what runs and what alarms now, and what started and ended in the last 24 hours, each
 * group over every version of the key (its header names the scope).
 */
export function KpiSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection((engine) => readKpis(engine, processKey), [processKey])
  return (
    <SectionState
      section={section}
      skeleton={
        <div className={ROW}>
          <KpiGridSkeleton cells={5} boxed />
          <KpiGridSkeleton cells={2} boxed />
        </div>
      }
    >
      {(kpis) => {
        const now: KpiCell[] = [
          { label: t("kpi.running"), value: figure(kpis.running) },
          {
            label: t("kpi.incidents"),
            value: figure(kpis.incidents, {
              situation: "openIncident",
              label: t("kpi.incidentsWhy"),
            }),
          },
          {
            label: t("kpi.withIncident"),
            value: figure(kpis.withIncident, {
              situation: "openIncident",
              label: t("kpi.withIncidentWhy"),
            }),
          },
          {
            label: t("kpi.failedJobs"),
            value: figure(kpis.failedJobs, {
              situation: "jobWithoutRetries",
              label: t("kpi.failedJobsWhy"),
            }),
          },
          { label: t("kpi.openTasks"), value: figure(kpis.openTasks) },
        ]
        const last24h: KpiCell[] = [
          { label: t("kpi.started"), value: figure(kpis.started24h) },
          { label: t("kpi.ended"), value: figure(kpis.ended24h) },
        ]
        return (
          <div className={ROW}>
            <KpiGrid
              boxed
              header={{ label: t("kpi.now"), badge: t("scope.allVersions") }}
              cells={now}
            />
            <KpiGrid
              boxed
              header={{ label: t("kpi.last24h"), badge: t("scope.allVersions") }}
              cells={last24h}
            />
          </div>
        )
      }}
    </SectionState>
  )
}
