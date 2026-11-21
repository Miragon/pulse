import { LogText, NamedId, Td, formatNumber } from "@miragon/pulse-ui"
import { ListRow, ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardActivity } from "../../view-models.js"
import { AlarmCount } from "../lib/alarm-count.js"
import { useT } from "../../messages/use-t.js"
import { TimeAgo } from "./time-ago.js"

/**
 * A process's failing activities, one row per activity and incident type of its root incidents, the
 * scope of a failure cluster: a row opens that cluster on a click or Enter and copies the activity's
 * id on Ctrl or Cmd with C (one row convention, as the webview's rows). A call activity's copies of
 * its called instances' incidents are no row: they count in the called process. An activity is
 * named by its diagram, its id quiet beside the name, and its failure in words, never its id a
 * second time. When it was first seen is a time ago with its instant in its title, as on every view.
 */
export function ActivityTable({
  processName,
  activities,
  onOpen,
}: {
  processName: string
  activities: ReadonlyArray<IncidentsDashboardActivity>
  onOpen: (activity: IncidentsDashboardActivity) => void
}) {
  const t = useT()
  const columns: ListTableColumn[] = [
    { label: t("incidentsList.colActivity") },
    { label: t("incidentsList.colError") },
    // From the scan: unknown ("—") unless it holds every incident of the process.
    { label: t("incidentsList.firstSeen"), align: "right", hideBelow: "sm", fit: true },
    { label: t("incidentsList.colIncidents"), align: "right", fit: true },
  ]
  return (
    <ListTable
      ariaLabel={t("incidentsList.activityTableLabel", { process: processName })}
      columns={columns}
    >
      {activities.map((activity) => (
        <ListRow
          key={`${activity.activityId} ${activity.incidentType}`}
          label={t("incidentsList.activityRowLabel", {
            activity: activity.activityName ?? activity.activityId,
          })}
          onOpen={() => onOpen(activity)}
          copy={activity.activityId}
        >
          <Td>
            <NamedId name={activity.activityName} id={activity.activityId} />
          </Td>
          <Td>
            {/* One line at the row height, whole in its title; none known is "—". */}
            <LogText kind="message" text={activity.representativeMessage} line />
          </Td>
          <Td align="right" className="text-muted-foreground whitespace-nowrap tabular-nums">
            <TimeAgo iso={activity.firstSeen} />
          </Td>
          {/* A neutral count with the incident's icon, never a coloured number (invariant 6). */}
          <Td align="right">
            <AlarmCount alarm={activity.scannedIncidentCount > 0 && "openIncidents"}>
              {formatNumber(activity.scannedIncidentCount)}
            </AlarmCount>
          </Td>
        </ListRow>
      ))}
    </ListTable>
  )
}
