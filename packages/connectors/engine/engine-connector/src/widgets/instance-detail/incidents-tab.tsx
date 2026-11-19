import { TableEmptyState } from "@miragon/pulse-ui"
import type { InstanceDetailData } from "../../view-models.js"
import { IncidentTable } from "../process-incidents/incident-table.js"
import type { IncidentRecoveryState } from "../process-incidents/use-incident-recovery.js"
import { useNav } from "../navigation.js"
import { useT } from "../../messages/use-t.js"

export function IncidentsTab({
  incidents,
  recovery,
  engine,
}: {
  incidents: InstanceDetailData["incidents"]
  recovery: IncidentRecoveryState
  engine?: string
}) {
  const t = useT()
  const go = useNav()
  if ((incidents ?? []).length === 0) {
    // Nothing wrong is neutral: the kit's empty note, as the variables' empty tab.
    return <TableEmptyState>{t("instanceDetail.noIncidents")}</TableEmptyState>
  }
  return (
    <IncidentTable
      incidents={incidents ?? []}
      recovery={recovery}
      onAnalyze={(incidentId) => go({ type: "incident-detail", incidentId })}
      subject="element"
      engine={engine}
    />
  )
}
