import { useMemo } from "react"
import { Alert, AlertDescription } from "@miragon/pulse-ui"
import type { BpmnViewerData } from "../../view-models.js"
import { BpmnDiagram, type BpmnHighlight } from "../bpmn-diagram.js"
import { useT } from "../../messages/use-t.js"

/** A view without a deployed diagram renders a neutral alert; the parent still composes header and legend. */
export function BpmnFlowViewer({ data }: { data: BpmnViewerData }) {
  const { activeActivityIds, incidentActivityIds, activityStats } = data
  const highlights = useMemo<BpmnHighlight[]>(
    () => [
      { kind: "active", activityIds: activeActivityIds },
      { kind: "incident", activityIds: incidentActivityIds },
      {
        kind: "failed-jobs",
        counts: activityStats
          .filter((s) => s.failedJobs > 0)
          .map((s) => ({ activityId: s.id, count: s.failedJobs })),
      },
      {
        kind: "instance-count",
        counts: activityStats
          .filter((s) => s.instances > 0)
          .map((s) => ({ activityId: s.id, count: s.instances })),
      },
    ],
    [activeActivityIds, incidentActivityIds, activityStats],
  )
  const t = useT()

  if (!data.diagramDefinitionId) {
    return (
      <Alert>
        <AlertDescription>{t("bpmnFlow.noDiagram")}</AlertDescription>
      </Alert>
    )
  }

  return (
    <BpmnDiagram
      definitionId={data.diagramDefinitionId}
      engineId={data.engineId}
      highlights={highlights}
    />
  )
}
