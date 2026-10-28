import { StatusBadge, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import type { BpmnViewerData } from "../../view-models.js"
import { HandOffButton, formatNumber } from "@miragon/pulse-widget-shell/widgets"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { InstanceLabel } from "../lib/identity.js"
import { useT } from "../../messages/use-t.js"

export function explainDiagramHandOff(data: BpmnViewerData): HandOff {
  return {
    intent: "askAi.bpmn.explainState",
    ids: {
      engine: data.engineId,
      processInstanceId: data.processInstanceId,
      processDefinitionId: data.processDefinitionId,
    },
    facts: {
      activeActivities: data.activeActivityIds,
      incidentActivities: data.incidentActivityIds,
      failedJobActivities: data.activityStats.filter((s) => s.failedJobs > 0).map((s) => s.id),
      // #335 N66: this instance's tokens, or every running instance of the version.
      statsScope: data.statsScope,
    },
    tools: [
      "camunda7_get_process_instance",
      "camunda7_list_incidents",
      "camunda7_get_job_stacktrace",
      "camunda7_get_process_instance_variables",
      "camunda7_get_process_definition_xml",
    ],
  }
}

export function BpmnViewerHeader({ data }: { data: BpmnViewerData | null }) {
  const t = useT()
  const { ask } = useHandOff()
  if (!data) return null
  const totalActive = data.activeActivityIds.length
  const totalIncidents = data.incidentActivityIds.length

  return (
    <WidgetHeader
      // Names before ids: the instance by its label, as the instance detail does (#322 U13).
      title={data.processDefinitionName ?? t("bpmnHeader.title")}
      sub={
        <>
          <EngineMeta engineId={data.engineId} />
          {data.processInstanceId && (
            <InstanceLabel id={data.processInstanceId} businessKey={data.businessKey} />
          )}
          {/* Running tokens are a state in progress (info); incidents are danger. */}
          {totalActive > 0 && (
            <StatusBadge tone="info">
              {t("bpmnHeader.activeCount", { count: formatNumber(totalActive) })}
            </StatusBadge>
          )}
          {totalIncidents > 0 && (
            <StatusBadge tone="danger">
              {t("bpmnHeader.incidentsCount", { count: formatNumber(totalIncidents) })}
            </StatusBadge>
          )}
        </>
      }
      actions={<HandOffButton action="explainDiagram" prompt={ask(explainDiagramHandOff(data))} />}
    />
  )
}
