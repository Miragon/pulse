import { HandOffButton, OpenInCockpitLink, VersionChip } from "@miragon/pulse-widget-shell/widgets"

import { StatusBadge, WidgetHeader } from "@miragon/mcp-toolkit-ui"
import type { IncidentDetailData } from "../../view-models.js"

import { scopingDefinitionKey, useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { InstanceLabel } from "../lib/identity.js"
import { useT } from "../../messages/use-t.js"

/** The cockpit's instance feed is app-only, so context comes from model-visible tools; engine text is quoted. */
export function diagnoseIncidentHandOff(data: IncidentDetailData): HandOff {
  const key = scopingDefinitionKey(data.processDefinitionKey, data.processDefinitionId)
  return {
    intent: "askAi.incident.diagnose",
    ids: {
      engine: data.engineId,
      processInstanceId: data.processInstanceId,
      processDefinitionKey: key,
      processDefinitionId: key ? undefined : data.processDefinitionId || undefined,
      activityId: data.activityId,
      jobId: data.job?.id,
    },
    facts: {
      incidentId: data.incidentId,
      incidentType: data.incidentType,
      version: data.processDefinitionVersion,
    },
    untrusted: [
      { label: "incidentMessage", text: data.incidentMessage ?? data.job?.exceptionMessage },
      { label: "activityName", text: data.activityName },
      { label: "processName", text: data.processDefinitionName },
      { label: "businessKey", text: data.businessKey },
    ],
    tools: [
      "camunda7_get_process_instance",
      "camunda7_get_process_instance_variables",
      "camunda7_get_job_stacktrace",
      "camunda7_list_incidents",
      "camunda7_query_historic_incidents",
    ],
  }
}

export function IncidentDetailHeader({
  data,
  resolved,
}: {
  data: IncidentDetailData
  resolved: boolean
}) {
  const t = useT()
  const { ask } = useHandOff()
  const cockpitInstanceUrl = data.cockpitInstanceUrl
  return (
    <WidgetHeader
      size="detail"
      badge={
        <StatusBadge tone={resolved ? "neutral" : "danger"}>
          {resolved ? t("incidentDetail.resolved") : data.incidentType}
        </StatusBadge>
      }
      // The activity by its name; its BPMN id only where it has none (#322 U13).
      title={data.activityName ?? <span className="font-mono">{data.activityId}</span>}
      sub={
        <>
          <span className="inline-flex items-center gap-1.5">
            {data.processDefinitionName ?? data.processDefinitionKey}
            {data.processDefinitionVersion !== null && (
              <VersionChip version={data.processDefinitionVersion} />
            )}
          </span>
          <span aria-hidden="true">·</span>
          {/* One instance label: its business key, the UUID a copyable chip. */}
          <InstanceLabel id={data.processInstanceId} businessKey={data.businessKey} />
          <EngineMeta engineId={data.engineId} />
        </>
      }
      actions={
        <>
          {cockpitInstanceUrl && (
            <OpenInCockpitLink
              url={cockpitInstanceUrl}
              vendor={data.engineVendor}
              label={t("incidentDetail.openInstanceIn", { vendor: data.engineVendor })}
            />
          )}
          <HandOffButton action="findCause" prompt={ask(diagnoseIncidentHandOff(data))} />
        </>
      }
    />
  )
}
