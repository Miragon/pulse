import { useMemo } from "react"
import { Alert, AlertDescription } from "@miragon/mcp-toolkit-ui"
import type { BpmnViewerData } from "../../view-models.js"
import { BpmnDiagram, type BpmnHighlight } from "../bpmn-diagram.js"
import { useT } from "../../messages/use-t.js"

/** Missing data renders a neutral alert; the parent still composes header and legend. */
export function BpmnFlowViewer({ data }: { data: BpmnViewerData | null }) {
  const highlights = useMemo<BpmnHighlight[]>(
    () => [
      { kind: "active", activityIds: data?.activeActivityIds ?? [] },
      { kind: "incident", activityIds: data?.incidentActivityIds ?? [] },
      {
        kind: "failed-jobs",
        counts: (data?.activityStats ?? [])
          .filter((s) => s.failedJobs > 0)
          .map((s) => ({ activityId: s.id, count: s.failedJobs })),
      },
      {
        kind: "instance-count",
        counts: (data?.activityStats ?? [])
          .filter((s) => s.instances > 0)
          .map((s) => ({ activityId: s.id, count: s.instances })),
      },
    ],
    [data?.activeActivityIds, data?.incidentActivityIds, data?.activityStats],
  )
  const t = useT()

  if (!data) {
    return (
      <Alert>
        <AlertDescription>{t("bpmnFlow.noData")}</AlertDescription>
      </Alert>
    )
  }

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
