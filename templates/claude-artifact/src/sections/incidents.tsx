import {
  CountFigure,
  DataTable,
  formatInstant,
  formatNumber,
  formatRelativeTime,
  NamedId,
  TableEmptyState,
  truncate,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { readIncidents, type IncidentGroup } from "../data/process-dashboard.ts"
import { useEngine, useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { Panel } from "../temporary/panel.tsx"
import { SectionState } from "../temporary/section-state.tsx"
import { CutNote } from "./cut-note.tsx"
import { rowAnchor, useElementNames } from "./names.ts"

/** The longest message a cell holds; its whole text is its title. */
const MESSAGE_MAX = 400

/**
 * The open root incidents by the activity they were raised at (every version), with the latest
 * message and when it came; under them, what each call activity waits on in the instances it
 * called, which counts as incidents of the called process, never here.
 */
export function IncidentsSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const { engine } = useEngine()
  const section = useSection((engine) => readIncidents(engine, processKey), [processKey])
  const nameOf = useElementNames(section.data?.process.xml)
  const now = engine.now()
  const columns: DataTableColumn<IncidentGroup>[] = [
    {
      key: "activity",
      label: t("incidents.activity"),
      fill: true,
      cell: (row) => (
        <span id={rowAnchor("incidents", row.activityId)} tabIndex={-1}>
          <NamedId name={nameOf(row.activityId)} id={row.activityId} />
        </span>
      ),
    },
    {
      key: "count",
      label: t("incidents.count"),
      align: "right",
      cell: (row) => (
        <CountFigure situation="openIncident" label={t("incidents.why")}>
          {formatNumber(row.count)}
        </CountFigure>
      ),
    },
    {
      key: "message",
      label: t("incidents.message"),
      // On a phone the activity, its count and when keep the row; the message waits for room.
      className: "max-sm:hidden",
      cellClassName: "max-sm:hidden",
      cell: (row) => (
        <span className="block max-w-48 truncate" title={row.latestMessage ?? undefined}>
          {truncate(row.latestMessage, MESSAGE_MAX)}
        </span>
      ),
    },
    {
      key: "latest",
      label: t("incidents.latest"),
      cell: (row) => (
        <time dateTime={row.latestAt ?? undefined} title={formatInstant(row.latestAt)}>
          {formatRelativeTime(row.latestAt, now)}
        </time>
      ),
    },
  ]
  return (
    <Panel id="incidents" title={t("incidents.title")} hint={t("scope.allVersions")}>
      <SectionState
        section={section}
        skeleton={<DataTable label={t("incidents.label")} columns={columns} skeletonRows={3} />}
      >
        {(data) => {
          const own = data.groups.filter((group) => group.kind === "own")
          const called = data.groups.filter((group) => group.kind === "called")
          return (
            <div className="flex flex-col gap-3">
              <CutNote cut={data.cut} />
              <DataTable
                label={t("incidents.label")}
                columns={columns}
                rows={own}
                rowKey={(row) => row.activityId}
                empty={<TableEmptyState variant="done">{t("incidents.empty")}</TableEmptyState>}
              />
              {called.map((group) => (
                <p
                  key={group.activityId}
                  id={rowAnchor("calledIncidents", group.activityId)}
                  tabIndex={-1}
                  className="text-muted-foreground m-0"
                >
                  {t("incidents.called", {
                    activity: nameOf(group.activityId) ?? group.activityId,
                    count: formatNumber(group.count),
                  })}
                </p>
              ))}
            </div>
          )
        }}
      </SectionState>
    </Panel>
  )
}
