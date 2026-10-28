import { useMemo } from "react"
import { Section } from "@miragon/pulse-widget-shell/widgets"

import { SectionHeading } from "@miragon/mcp-toolkit-ui"
import type { InstanceDetailData, OpenUserTask } from "../../view-models.js"
import { BpmnDiagram, type BpmnHighlight } from "../bpmn-diagram.js"
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
  const highlights = useMemo<BpmnHighlight[]>(
    () => [
      { kind: "active", activityIds: activeActivityIds },
      { kind: "incident", activityIds: incidentActivityIds },
      {
        kind: "open-task",
        activityIds: visibleTasks.map((task) => task.taskDefinitionKey),
      },
    ],
    [activeActivityIds, incidentActivityIds, visibleTasks],
  )
  if (!diagramDefinitionId && !activityTree) return null
  return (
    <section>
      {diagramDefinitionId && (
        <>
          <SectionHeading title={t("instanceDetail.sectionDiagram")} />
          <BpmnDiagram
            definitionId={diagramDefinitionId}
            engineId={engineId}
            highlights={highlights}
          />
        </>
      )}
      {/* Textual token view next to the diagram — shows multi-instance
          nesting the diagram overlay can't, collapsed by default. */}
      {activityTree && (
        <Section title={t("instanceDetail.sectionActivityTree")}>
          <ActivityNode node={activityTree} />
        </Section>
      )}
    </section>
  )
}
