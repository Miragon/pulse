import {
  DataTable,
  formatInstant,
  formatNumber,
  formatRelativeTime,
  NamedId,
  Panel,
  SectionState,
  TableEmptyState,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { readActivities, tasksOf, type ActivityRow } from "../data/process-dashboard.ts"
import { useEngine, useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { rowAnchor } from "./anchors.ts"

/**
 * The open tasks by task (every version): how many wait at each, and since when the oldest.
 * `engine_activity_counts`, shared with the diagram and the incidents.
 */
export function TasksSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const { engine } = useEngine()
  const section = useSection(
    (engine) => readActivities(engine, processKey),
    [processKey],
    (counts) => counts.asOf,
  )
  const now = engine.now()
  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: "task",
      label: t("tasks.task"),
      fill: true,
      cell: (row) => (
        <span id={rowAnchor("tasks", row.activityId)} tabIndex={-1}>
          <NamedId name={row.name} id={row.activityId} />
        </span>
      ),
    },
    {
      key: "count",
      label: t("tasks.count"),
      align: "right",
      cell: (row) => <span className="tabular-nums">{formatNumber(row.openTasks)}</span>,
    },
    {
      key: "oldest",
      label: t("tasks.oldest"),
      cell: (row) => (
        <time dateTime={row.oldestOpenTask ?? undefined} title={formatInstant(row.oldestOpenTask)}>
          {formatRelativeTime(row.oldestOpenTask, now)}
        </time>
      ),
    },
  ]
  return (
    <Panel id="tasks" title={t("tasks.title")} hint={t("scope.allVersions")}>
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={<DataTable label={t("tasks.label")} columns={columns} skeletonRows={3} />}
      >
        {(counts) => (
          <DataTable
            label={t("tasks.label")}
            columns={columns}
            rows={tasksOf(counts)}
            rowKey={(row) => row.activityId}
            empty={<TableEmptyState variant="done">{t("tasks.empty")}</TableEmptyState>}
          />
        )}
      </SectionState>
    </Panel>
  )
}
