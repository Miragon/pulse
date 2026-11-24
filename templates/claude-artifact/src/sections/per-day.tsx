import {
  BarChart,
  Facts,
  formatDate,
  formatDuration,
  formatNumber,
  Panel,
  SectionState,
  Skeleton,
  TableEmptyState,
} from "@miragon/pulse-ui"
import { historyCutOf, readStats, type ProcessStats } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"

/** The chart's room while its first read runs: the plot and its axis. */
const SKELETON_HEIGHT = 224

/** No instance started or ended on any day of the chart: every count a known 0, none unknown. */
const isQuiet = (stats: ProcessStats) =>
  stats.buckets.every((day) => day.started === 0 && day.ended === 0)

/**
 * Whose durations the median and P90 are: of the instances that ended in the chart's days, or
 * since the day the engine keeps their history from, where that is later; none where unknown.
 */
function durationScope(stats: ProcessStats, t: ReturnType<typeof useT>): string {
  const { durations } = stats
  if (durations === null) return t("perDay.durationUnknown")
  const count = formatNumber(durations.ended)
  if (Date.parse(durations.from) > Date.parse(stats.range.from)) {
    return t("perDay.durationSince", { count, date: formatDate(durations.from) })
  }
  return t("perDay.durationScope", { count })
}

/**
 * Started and ended per day over the last 14 days, each day in the viewer's time zone, and the
 * median and P90 duration of the instances that ended in them: `engine_process_stats` per day,
 * shared with the tiles. A day the engine may have removed history of counts at least, and the
 * section says from when it keeps it.
 */
export function PerDaySection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection(
    (engine) => readStats(engine, processKey),
    [processKey],
    (stats) => stats.asOf,
  )
  return (
    <Panel title={t("perDay.title")} hint={`${t("perDay.scope")}, ${t("scope.allVersions")}`}>
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={<Skeleton className="w-full" style={{ height: SKELETON_HEIGHT }} />}
        isEmpty={isQuiet}
        empty={<TableEmptyState>{t("perDay.empty")}</TableEmptyState>}
      >
        {(stats) => {
          const cut = historyCutOf(stats)
          return (
            <div className="flex flex-col gap-4">
              {stats.history.recorded === false && (
                <p className="text-muted-foreground m-0">{t("perDay.noHistory")}</p>
              )}
              {cut !== null && (
                <p className="text-muted-foreground m-0">
                  {t("perDay.historyCut", { date: formatDate(cut.toISOString()) })}
                </p>
              )}
              <BarChart
                label={t("perDay.chart")}
                categoryLabel={t("perDay.day")}
                series={[
                  { key: "started", label: t("perDay.started") },
                  { key: "ended", label: t("perDay.ended") },
                ]}
                points={stats.buckets.map((day) => ({
                  key: day.start,
                  label: formatDate(day.start),
                  values: { started: day.started, ended: day.ended },
                }))}
              />
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground m-0">{durationScope(stats, t)}</p>
                <Facts
                  facts={[
                    {
                      label: t("perDay.median"),
                      value: formatDuration(stats.durations?.medianMs ?? null),
                    },
                    {
                      label: t("perDay.p90"),
                      value: formatDuration(stats.durations?.p90Ms ?? null),
                    },
                  ]}
                />
              </div>
            </div>
          )
        }}
      </SectionState>
    </Panel>
  )
}
