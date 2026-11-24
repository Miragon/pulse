import {
  DataTable,
  formatInstant,
  formatNumber,
  formatRelativeTime,
  NamedId,
  TableEmptyState,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { readTasks, type TaskGroup } from "../data/process-dashboard.ts"
import { useEngine, useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { Panel } from "../temporary/panel.tsx"
import { SectionState } from "../temporary/section-state.tsx"
import { CutNote } from "./cut-note.tsx"
import { rowAnchor, useElementNames } from "./names.ts"

/** The open tasks by task (every version): how many wait at each, and since when the oldest. */
export function TasksSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const { engine } = useEngine()
  const section = useSection((engine) => readTasks(engine, processKey), [processKey])
  const nameOf = useElementNames(section.data?.process.xml)
  const now = engine.now()
  const columns: DataTableColumn<TaskGroup>[] = [
    {
      key: "task",
      label: t("tasks.task"),
      fill: true,
      cell: (row) => (
        <span id={rowAnchor("tasks", row.taskDefinitionKey)} tabIndex={-1}>
          <NamedId name={nameOf(row.taskDefinitionKey, row.name)} id={row.taskDefinitionKey} />
        </span>
      ),
    },
    {
      key: "count",
      label: t("tasks.count"),
      align: "right",
      cell: (row) => <span className="tabular-nums">{formatNumber(row.count)}</span>,
    },
    {
      key: "oldest",
      label: t("tasks.oldest"),
      cell: (row) => (
        <time dateTime={row.oldestCreated ?? undefined} title={formatInstant(row.oldestCreated)}>
          {formatRelativeTime(row.oldestCreated, now)}
        </time>
      ),
    },
  ]
  return (
    <Panel id="tasks" title={t("tasks.title")} hint={t("scope.allVersions")}>
      <SectionState
        section={section}
        skeleton={<DataTable label={t("tasks.label")} columns={columns} skeletonRows={3} />}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            <CutNote cut={data.cut} />
            <DataTable
              label={t("tasks.label")}
              columns={columns}
              rows={data.groups}
              rowKey={(row) => row.taskDefinitionKey}
              empty={<TableEmptyState variant="done">{t("tasks.empty")}</TableEmptyState>}
            />
          </div>
        )}
      </SectionState>
    </Panel>
  )
}
