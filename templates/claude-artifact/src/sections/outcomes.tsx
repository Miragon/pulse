import { formatNumber, formatPercent, Skeleton, TableEmptyState } from "@miragon/pulse-ui"
import { readOutcomes } from "../data/process-dashboard.ts"
import { useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { MeterRows } from "../temporary/meter-rows.tsx"
import { Panel } from "../temporary/panel.tsx"
import { SectionState } from "../temporary/section-state.tsx"
import { CutNote } from "./cut-note.tsx"
import { useElementNames } from "./names.ts"

/**
 * The plain end events reached in the chart's 14 days, every version: how often each, and its
 * share of every end event reached. They are end events, not instances: an instance can reach
 * more than one (a non-interrupting branch ends at its own), so the section never calls a share
 * one of the instances.
 */
export function OutcomesSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const section = useSection((engine) => readOutcomes(engine, processKey), [processKey])
  const nameOf = useElementNames(section.data?.process.xml)
  return (
    <Panel title={t("outcomes.title")} hint={`${t("outcomes.scope")}, ${t("scope.allVersions")}`}>
      <SectionState section={section} skeleton={<Skeleton className="h-40 w-full" />}>
        {(data) => {
          if (data.reached === 0) {
            return (
              <div className="flex flex-col gap-3">
                <CutNote cut={data.cut} />
                <TableEmptyState description={t("outcomes.emptyHint")}>
                  {t("outcomes.empty")}
                </TableEmptyState>
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-3">
              <CutNote cut={data.cut} />
              <MeterRows
                label={t("outcomes.label")}
                rows={data.outcomes.map((row) => ({
                  key: row.activityId,
                  label: nameOf(row.activityId, row.activityName) ?? row.activityId,
                  value: t("outcomes.share", {
                    count: formatNumber(row.count),
                    percent: formatPercent((row.count / data.reached) * 100, {
                      maximumFractionDigits: 0,
                    }),
                  }),
                  share: row.count / data.reached,
                }))}
              />
              <p className="text-muted-foreground m-0">
                {t("outcomes.shareOf", { count: formatNumber(data.reached) })}
              </p>
            </div>
          )
        }}
      </SectionState>
    </Panel>
  )
}
