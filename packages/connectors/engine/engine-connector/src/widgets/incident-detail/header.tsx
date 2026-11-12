import { VersionChip, StatusBadge, WidgetHeader, SITUATION_TONES } from "@miragon/pulse-ui"
import { HandOffButton, OpenInCockpitLink } from "@miragon/pulse-widget-shell/widgets"

import type { IncidentDetailData } from "../../view-models.js"

import { scopingDefinitionKey, useHandOff, type HandOff } from "../lib/hand-off.js"
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
        <StatusBadge tone={resolved ? "neutral" : SITUATION_TONES.openIncident}>
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
