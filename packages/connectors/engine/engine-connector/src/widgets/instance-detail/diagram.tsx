import { useMemo } from "react"
import { Section, SectionHeading } from "@miragon/pulse-ui"
import type { DiagramMarker } from "@miragon/pulse-ui/bpmn"
import type { InstanceDetailData, OpenUserTask } from "../../view-models.js"
import { BpmnDiagram } from "../bpmn-diagram.js"
import { ActivityNode } from "../instance-sections.js"
import { useT } from "../../messages/use-t.js"

export function InstanceDiagramSection({
  diagramDefinitionId,
  engineId,
  activityTree,
  activeActivityIds,
  incidentActivityIds,
  visibleTasks,
}: {
  diagramDefinitionId: string | null
  engineId?: string
  activityTree: InstanceDetailData["activityTree"]
  activeActivityIds: string[]
  incidentActivityIds: string[]
  visibleTasks: OpenUserTask[]
}) {
  const t = useT()
  // Where the instance waits, its open user tasks and its incidents, the strongest one an element.
  const markers = useMemo<DiagramMarker[]>(
    () => [
      ...activeActivityIds.map((elementId) => ({ elementId, kind: "running" as const })),
      ...visibleTasks.map((task) => ({
        elementId: task.taskDefinitionKey,
        kind: "openTask" as const,
      })),
      ...incidentActivityIds.map((elementId) => ({ elementId, kind: "incident" as const })),
    ],
    [activeActivityIds, incidentActivityIds, visibleTasks],
  )
  if (!diagramDefinitionId && !activityTree) return null
  return (
    <section>
      {diagramDefinitionId && (
        <>
          <SectionHeading as="h2" title={t("instanceDetail.sectionDiagram")} />
          <BpmnDiagram definitionId={diagramDefinitionId} engineId={engineId} markers={markers} />
        </>
      )}
      {/* Textual token view next to the diagram: shows multi-instance
          nesting the diagram overlay can't, collapsed by default. */}
      {activityTree && (
        <Section as="h2" title={t("instanceDetail.sectionActivityTree")}>
          <ActivityNode node={activityTree} />
        </Section>
      )}
    </section>
  )
}
