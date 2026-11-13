import { formatTimestamp } from "@miragon/pulse-ui"

import type { ProcessIncidentsActivity } from "../../view-models.js"
import { GroupSummaryRow } from "../group-summary-row.js"
import { useT } from "../../messages/use-t.js"

export function ActivitySummary({
  activity,
  expanded,
}: {
  activity: ProcessIncidentsActivity
  expanded: boolean
}) {
  const t = useT()
  return (
    <GroupSummaryRow
      title={activity.activityName ?? activity.activityId}
      subline={activity.representativeMessage ?? activity.activityId}
      stats={[
        { value: formatTimestamp(activity.firstSeen), label: t("procIncSummary.firstSeen") },
        { value: formatTimestamp(activity.latestIncident), label: t("procIncSummary.latest") },
      ]}
      incidents={activity.incidentCount}
      expanded={expanded}
    />
  )
}
