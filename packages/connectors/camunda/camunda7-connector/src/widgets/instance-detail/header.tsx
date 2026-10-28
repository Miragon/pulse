import {
  Button,
  KpiGrid,
  StatusBadge,
  WidgetHeader,
  type ToneVariant,
} from "@miragon/mcp-toolkit-ui"
import {
  HandOffButton,
  IdText,
  VersionChip,
  formatNumber,
} from "@miragon/pulse-widget-shell/widgets"

import type { InstanceDetailData } from "../../view-models.js"
import { type T, useT } from "../../messages/use-t.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { EngineMeta } from "../lib/engine-context.js"
import { definitionVersionOf } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"

export interface InstanceStatus {
  label: string
  tone: ToneVariant
}

/** Shared by header and KPI strip. */
export function instanceStatus(
  t: T,
  { cancelled, ended, isSuspended }: { cancelled: boolean; ended: boolean; isSuspended: boolean },
): InstanceStatus {
  const label = cancelled
    ? t("instanceDetail.statusCancelled")
    : ended
      ? t("instanceDetail.statusEnded")
      : isSuspended
        ? t("instanceDetail.statusSuspended")
        : t("instanceDetail.statusRunning")
  // #322 U14: green would claim "done well", and ended or cancelled is no alarm.
  const tone = cancelled || ended ? ("neutral" as const) : isSuspended ? "warning" : "info"
  return { label, tone }
}

/** A plan, never an execution; the business key is quoted. */
export function diagnoseInstanceHandOff({
  instance,
  engineId,
  activeActivityIds,
  incidentActivityIds,
}: {
  instance: InstanceDetailData["instance"]
  engineId: string | undefined
  activeActivityIds: string[]
  incidentActivityIds: string[]
}): HandOff {
  return {
    intent: "askAi.instance.diagnose",
    ids: {
      engine: engineId,
      processInstanceId: instance.id,
      processDefinitionId: instance.definitionId,
    },
    facts: { activeActivities: activeActivityIds, incidentActivities: incidentActivityIds },
    untrusted: [{ label: "businessKey", text: instance.businessKey }],
    tools: [
      "camunda7_get_process_instance",
      "camunda7_get_activity_instance_tree",
      "camunda7_get_process_instance_variables",
      "camunda7_list_incidents",
      "camunda7_get_job_stacktrace",
      "camunda7_set_job_retries",
      "camunda7_set_process_instance_variable",
      "camunda7_modify_process_instance",
    ],
  }
}

export function InstanceHeader({
  instance,
  processName,
  status,
  engineId,
  activeActivityIds,
  incidentActivityIds,
  isSuspended,
  isActionable,
  isMutatingInstance,
  onRequestSuspendToggle,
  onRequestCancel,
}: {
  instance: InstanceDetailData["instance"]
  processName: string | null
  status: InstanceStatus
  engineId?: string
  activeActivityIds: string[]
  incidentActivityIds: string[]
  isSuspended: boolean
  isActionable: boolean
  isMutatingInstance: boolean
  onRequestSuspendToggle?: () => void
  onRequestCancel?: () => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const version = definitionVersionOf(instance.definitionId)
  return (
    <WidgetHeader
      size="detail"
      badge={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      // The instance by its ONE label: business key, else short id (#322 U13).
      title={instanceName(instance.id, instance.businessKey)}
      sub={
        <>
          <span className="inline-flex items-center gap-1.5">
            {processName ?? t("instanceDetail.title")}
            {version !== null && <VersionChip version={version} />}
          </span>
          <IdText value={instance.id} />
          <EngineMeta engineId={engineId} />
        </>
      }
      actions={
        <>
          {isActionable && onRequestSuspendToggle && (
            <Button
              variant="outline"
              size="sm"
              disabled={isMutatingInstance}
              onClick={onRequestSuspendToggle}
            >
              {isSuspended ? t("instanceDetail.activate") : t("instanceDetail.suspend")}
            </Button>
          )}
          {isActionable && onRequestCancel && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isMutatingInstance}
              onClick={onRequestCancel}
            >
              {t("instanceDetail.cancelInstance")}
            </Button>
          )}
          <HandOffButton
            action="findCause"
            prompt={ask(
              diagnoseInstanceHandOff({
                instance,
                engineId,
                activeActivityIds: activeActivityIds ?? [],
                incidentActivityIds: incidentActivityIds ?? [],
              }),
            )}
          />
        </>
      }
    />
  )
}

export function InstanceKpis({
  status,
  openTaskCount,
  openIncidentCount,
  variableCount,
}: {
  status: InstanceStatus
  openTaskCount: number
  openIncidentCount: number
  variableCount: number
}) {
  const t = useT()
  return (
    <KpiGrid
      boxed
      cells={[
        {
          label: t("instanceDetail.kpiState"),
          value: status.label,
          tone: status.tone,
        },
        {
          label: t("instanceDetail.kpiOpenTasks"),
          value: formatNumber(openTaskCount),
        },
        {
          label: t("instanceDetail.kpiOpenIncidents"),
          value: formatNumber(openIncidentCount),
          tone: openIncidentCount > 0 ? "danger" : undefined,
        },
        {
          label: t("instanceDetail.kpiVariables"),
          value: formatNumber(variableCount),
        },
      ]}
    />
  )
}
