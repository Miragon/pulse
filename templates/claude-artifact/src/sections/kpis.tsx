import type { ReactNode } from "react"
import {
  CountFigure,
  formatCount,
  KpiGrid,
  KpiGridSkeleton,
  SectionState,
  type KpiCell,
} from "@miragon/pulse-ui"
import type { Count } from "@miragon/pulse-ui/format"
import type { Situation } from "@miragon/pulse-ui/tones"
import { useSectionRead } from "@miragon/pulse-widget-shell/widgets"
import { readStats } from "../data/process-dashboard.ts"
import { useT } from "../messages.ts"

/** The two groups side by side from `lg`: what holds now in five tiles, the last 24 hours in two. */
function Groups({ now, last24h }: { readonly now: ReactNode; readonly last24h: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
      <div className="min-w-0 lg:col-span-5">{now}</div>
      <div className="min-w-0 lg:col-span-2">{last24h}</div>
    </div>
  )
}

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
 * group over every version of the key (its header names the scope), in one region named the key
 * figures, which a screen reader lists beside the panels. One call, shared with the chart and the
 * end events: `engine_process_stats`.
 */
export function KpiSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSectionRead(["stats", processKey], (reader) => readStats(reader, processKey))
  return (
    <section aria-label={t("kpi.title")}>
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={
          <Groups
            now={<KpiGridSkeleton cells={5} boxed />}
            last24h={<KpiGridSkeleton cells={2} boxed />}
          />
        }
      >
        {({ now: kpis }) => {
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
            { label: t("kpi.started"), value: figure(kpis.startedLast24h) },
            { label: t("kpi.ended"), value: figure(kpis.endedLast24h) },
          ]
          return (
            <Groups
              now={
                <KpiGrid
                  boxed
                  header={{ label: t("kpi.now"), badge: t("scope.allVersions") }}
                  cells={now}
                />
              }
              last24h={
                <KpiGrid
                  boxed
                  header={{ label: t("kpi.last24h"), badge: t("scope.allVersions") }}
                  cells={last24h}
                />
              }
            />
          )
        }}
      </SectionState>
    </section>
  )
}
