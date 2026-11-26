import {
  CountFigure,
  DataTable,
  formatInstant,
  formatNumber,
  formatRelativeTime,
  LogText,
  NamedId,
  Panel,
  SectionState,
  TableEmptyState,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { usePageReads, useSectionRead } from "@miragon/pulse-widget-shell/widgets"
import { incidentsOf, readActivities, type ActivityRow } from "../data/process-dashboard.ts"
import { useT } from "../messages.ts"
import { rowAnchor } from "./anchors.ts"

/**
 * The open root incidents by the activity they were raised at (every version), with the latest
 * message and when it came; under them, what each call activity waits on in the instances it
 * called, which counts as incidents of the called process, never here. `engine_activity_counts`,
 * shared with the diagram and the open tasks.
 */
export function IncidentsSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const page = usePageReads()
  const section = useSectionRead(["activities", processKey], (reader) =>
    readActivities(reader, processKey),
  )
  const now = page.now()
  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: "activity",
      label: t("incidents.activity"),
      fill: true,
      cell: (row) => (
        <span id={rowAnchor("incidents", row.activityId)} tabIndex={-1}>
          <NamedId name={row.name} id={row.activityId} />
        </span>
      ),
    },
    {
      key: "count",
      label: t("incidents.count"),
      align: "right",
      cell: (row) => (
        <CountFigure situation="openIncident" label={t("incidents.why")}>
          {formatNumber(row.incidents)}
        </CountFigure>
      ),
    },
    {
      key: "latest",
      label: t("incidents.latest"),
      cell: (row) => (
        <time dateTime={row.latestIncident?.at} title={formatInstant(row.latestIncident?.at)}>
          {formatRelativeTime(row.latestIncident?.at, now)}
        </time>
      ),
    },
    // Last: on a phone the activity, its count and when keep the row in view, and the message,
    // one line with its whole text behind its disclosure, is what the table's region scrolls to.
    {
      key: "message",
      label: t("incidents.message"),
      cell: (row) => <LogText kind="message" line text={row.latestIncident?.message} />,
    },
  ]
  return (
    <Panel id="incidents" title={t("incidents.title")} hint={t("scope.allVersions")}>
      <SectionState
        state={section.state}
        onRetry={section.retry}
        skeleton={<DataTable label={t("incidents.label")} columns={columns} skeletonRows={3} />}
      >
        {(counts) => {
          const { own, called } = incidentsOf(counts)
          return (
            <div className="flex flex-col gap-3">
              <DataTable
                label={t("incidents.label")}
                columns={columns}
                rows={own}
                rowKey={(row) => row.activityId}
                empty={<TableEmptyState>{t("incidents.empty")}</TableEmptyState>}
              />
              {called.map((row) => (
                <p
                  key={row.activityId}
                  id={rowAnchor("calledIncidents", row.activityId)}
                  tabIndex={-1}
                  className="text-muted-foreground m-0"
                >
                  {t("incidents.called", {
                    activity: row.name ?? row.activityId,
                    count: formatNumber(row.incidentsInCalledInstances),
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
