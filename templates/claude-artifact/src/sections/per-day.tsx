import {
  Facts,
  formatDate,
  formatDuration,
  formatNumber,
  Skeleton,
  TableEmptyState,
} from "@miragon/pulse-ui"
import { readPerDay } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { BarChart } from "../temporary/bar-chart.tsx"
import { Panel } from "../temporary/panel.tsx"
import { SectionState } from "../temporary/section-state.tsx"
import { CutNote } from "./cut-note.tsx"

/**
 * Started and ended per day over the last 14 days, each day in the viewer's time zone, and the
 * median and P90 duration of the instances that ended in them. A cut read says its bars may be too
 * low and its median and P90 over how many instances they were read.
 */
export function PerDaySection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection((engine) => readPerDay(engine, processKey), [processKey])
  return (
    <Panel title={t("perDay.title")} hint={`${t("perDay.scope")}, ${t("scope.allVersions")}`}>
      <SectionState section={section} skeleton={<Skeleton className="h-56 w-full" />}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <CutNote cut={data.cut} />
            {data.days.every((day) => day.started === 0 && day.ended === 0) ? (
              <TableEmptyState>{t("perDay.empty")}</TableEmptyState>
            ) : (
              <BarChart
                label={t("perDay.chart")}
                series={[
                  {
                    key: "started",
                    label: t("perDay.started"),
                    fill: "fill-chart-1",
                    swatch: "bg-chart-1",
                  },
                  {
                    key: "ended",
                    label: t("perDay.ended"),
                    fill: "fill-chart-3",
                    swatch: "bg-chart-3",
                  },
                ]}
                points={data.days.map((day) => {
                  const label = formatDate(day.day.toISOString())
                  return {
                    key: day.day.toISOString(),
                    label,
                    description: t("perDay.day", {
                      day: label,
                      started: formatNumber(day.started),
                      ended: formatNumber(day.ended),
                    }),
                    values: [day.started, day.ended],
                  }
                })}
              />
            )}
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground m-0">
                {data.durationsComplete
                  ? t("perDay.durationScope")
                  : t("perDay.durationScopeRead", { count: formatNumber(data.durationsRead) })}
              </p>
              <Facts
                facts={[
                  { label: t("perDay.median"), value: formatDuration(data.medianMs) },
                  { label: t("perDay.p90"), value: formatDuration(data.p90Ms) },
                ]}
              />
            </div>
          </div>
        )}
      </SectionState>
    </Panel>
  )
}
