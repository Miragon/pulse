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
    return <p className="text-muted-foreground text-dense">{t("instanceDetail.noIncidents")}</p>
  }
  return (
    <IncidentTable
      incidents={incidents ?? []}
      recovery={recovery}
      onAnalyze={(incidentId) => go({ type: "incident-detail", incidentId })}
      hideInstanceColumn
      engine={engine}
    />
  )
}
