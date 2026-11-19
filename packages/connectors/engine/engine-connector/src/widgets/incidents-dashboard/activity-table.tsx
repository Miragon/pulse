import { LogText, NamedId, Td, formatNumber } from "@miragon/pulse-ui"
import { ListRow, ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardActivity } from "../../view-models.js"
import { AlarmCount } from "../lib/alarm-count.js"
import { useT, type T } from "../../messages/use-t.js"
import { TimeAgo } from "./time-ago.js"

/**
 * A row named by what it opens: its activity's failure cluster, a delegated row's root cause's
 * cluster, and with that root beyond the scan its process's view.
 */
function rowLabel(t: T, activity: IncidentsDashboardActivity, processName: string): string {
  const name = activity.activityName ?? activity.activityId
  if (!activity.delegated) return t("incidentsList.activityRowLabel", { activity: name })
  const cause = activity.rootCause
  return cause
    ? t("incidentsList.causeRowLabel", {
        activity: name,
        cause: cause.activityName ?? cause.activityId,
      })
    : t("incidentsList.processRowLabel", { activity: name, process: processName })
}

/**
 * A process's failing activities, one row per activity and incident type, the scope of a failure
 * cluster: a row opens that cluster on a click or Enter (a delegated row the cause it stands for)
 * and copies the activity's id on Ctrl or Cmd with C (one row convention, as the webview's rows).
 * An activity is named by its diagram, its id quiet beside the name, and its failure in words (a
 * propagated incident's root cause where the scan holds it), never its id a second time. When it
 * was first seen is a time ago with its instant in its title, as on every view.
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
          label={rowLabel(t, activity, processName)}
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
