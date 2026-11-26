import {
  formatCount,
  MeterRows,
  Panel,
  SectionState,
  Skeleton,
  TableEmptyState,
} from "@miragon/pulse-ui"
import { useSectionRead } from "@miragon/pulse-widget-shell/widgets"
import {
  outcomesEmptyOf,
  outcomesOf,
  readStats,
  type OutcomesEmpty,
  type ProcessStats,
} from "../data/process-dashboard.ts"
import { useT } from "../messages.ts"

/** The rows' room while the first read runs. */
const SKELETON_HEIGHT = 160

/** What the panel says where no end event shows, by why. */
const EMPTY_TEXT = {
  none: "outcomes.empty",
  noEndEvent: "outcomes.noEndEvent",
  noHistory: "outcomes.noHistory",
} as const satisfies Record<OutcomesEmpty, string>

/**
 * The end events reached in the chart's 14 days, every version: how many of the instances that
 * ended reached each, and that share of them. An instance can reach more than one (a
 * non-interrupting branch ends at its own), so the shares are each of every instance that ended
 * and may add up to more than 100 %. Where that whole is not exact (the engine may have removed
 * some of these days' history, or writes none), `MeterRows` shows no share and the page says why.
 * Where no end event shows, it says why too: no instance ended, they ended without reaching one,
 * or the engine writes no history. `engine_process_stats`, shared with the tiles and the chart.
 */
export function OutcomesSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSectionRead(["stats", processKey], (reader) => readStats(reader, processKey))
  return (
    <Panel title={t("outcomes.title")} hint={`${t("outcomes.scope")}, ${t("scope.allVersions")}`}>
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={<Skeleton className="w-full" style={{ height: SKELETON_HEIGHT }} />}
        isEmpty={(stats: ProcessStats) => outcomesOf(stats).outcomes.length === 0}
        empty={
          section.data === undefined ? undefined : (
            <TableEmptyState>{t(EMPTY_TEXT[outcomesEmptyOf(section.data)])}</TableEmptyState>
          )
        }
      >
        {(stats) => {
          const data = outcomesOf(stats)
          return (
            <div className="flex flex-col gap-3">
              <MeterRows
                label={t("outcomes.label")}
                total={data.ended}
                rows={data.outcomes.map((event) => ({
                  key: event.activityId,
                  label: event.name ?? event.activityId,
                  value: event.ended,
                }))}
              />
              <p className="text-muted-foreground m-0">
                {typeof data.ended === "number"
                  ? t("outcomes.shareOf", { count: formatCount(data.ended) })
                  : t("outcomes.noShare")}
              </p>
            </div>
          )
        }}
      </SectionState>
    </Panel>
  )
}
