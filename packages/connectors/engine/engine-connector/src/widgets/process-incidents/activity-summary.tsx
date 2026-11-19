import type { ReactNode } from "react"

import type { ProcessIncidentsActivity } from "../../view-models.js"
import { GroupSummaryRow } from "../group-summary-row.js"
import { TimeAgo } from "../incidents-dashboard/time-ago.js"
import { useT } from "../../messages/use-t.js"

/** The group's name in its toggle: the activity, on one line. */
export function ActivityTitle({ activity }: { activity: ProcessIncidentsActivity }) {
  return <span className="block truncate">{activity.activityName ?? activity.activityId}</span>
}

/** An activity's group summary around its `GroupCard` toggle (the chevron and the activity). */
export function ActivitySummary({
  activity,
  toggle,
}: {
  activity: ProcessIncidentsActivity
  toggle: ReactNode
}) {
  const t = useT()
  return (
    <GroupSummaryRow
      title={toggle}
      toggled
      // The cause in words, else the id beside a name; never the title again (an unnamed one).
      subline={
        activity.representativeMessage ?? (activity.activityName ? activity.activityId : undefined)
      }
      stats={[
        { value: <TimeAgo iso={activity.firstSeen} />, label: t("procIncSummary.firstSeen") },
        { value: <TimeAgo iso={activity.latestIncident} />, label: t("procIncSummary.latest") },
      ]}
      incidents={activity.incidentCount}
    />
  )
}
