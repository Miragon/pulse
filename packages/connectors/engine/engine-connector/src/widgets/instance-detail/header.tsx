import {
  Button,
  Facts,
  Icon,
  StateLabel,
  StatusBadge,
  SITUATION_TONES,
  WidgetHeader,
  type StateLabelState,
  type ToneVariant,
  VersionChip,
  formatNumber,
} from "@miragon/pulse-ui"
import { HandOffButton, IdText } from "@miragon/pulse-widget-shell/widgets"
import { Ban, Pause, Play, Workflow } from "lucide-react"

import type { InstanceDetailData } from "../../view-models.js"
import { type T, useT } from "../../messages/use-t.js"
import { AlarmCount } from "../lib/alarm-count.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { definitionVersionOf } from "../lib/identity.js"
import { instanceName } from "../lib/write-feedback.js"

export interface InstanceStatus {
  label: string
  tone: ToneVariant
  /** The kit's state, whose icon a `StateLabel` draws. */
  state: StateLabelState
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
  const state: StateLabelState = cancelled
    ? "cancelled"
    : ended
      ? "ended"
      : isSuspended
        ? "suspended"
        : "running"
  // The one table every Pulse UI reads: running is info, suspended and ended are neutral.
  const tone = SITUATION_TONES[cancelled || ended ? "ended" : isSuspended ? "suspended" : "running"]
  return { label, tone, state }
}

/** A plan, never an execution; the business key is quoted. */
function diagnoseInstanceHandOff({
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
  onOpenProcess,
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
  /** Opens the instance's process in the cockpit; absent while its key is unknown. */
  onOpenProcess?: () => void
  onRequestSuspendToggle?: () => void
  onRequestCancel?: () => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const version = definitionVersionOf(instance.definitionId)
  return (
    <WidgetHeader
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
        </>
      }
      // The meta line names the process (facts only); the way to it is the first action.
      actions={
        <>
          {onOpenProcess && (
            <Button type="button" variant="toolbar" size="sm" onClick={onOpenProcess}>
              <Icon icon={Workflow} />
              {t("instanceDetail.viewProcess")}
            </Button>
          )}
          {isActionable && onRequestSuspendToggle && (
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              disabled={isMutatingInstance}
              onClick={onRequestSuspendToggle}
            >
              <Icon icon={isSuspended ? Play : Pause} />
              {isSuspended ? t("instanceDetail.activate") : t("instanceDetail.suspend")}
            </Button>
          )}
          {isActionable && onRequestCancel && (
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isMutatingInstance}
              onClick={onRequestCancel}
            >
              <Icon icon={Ban} />
              {t("instanceDetail.cancelInstance")}
            </Button>
          )}
          <HandOffButton
            action="findCause"
            variant="toolbar"
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

/**
 * The instance's key facts (the webview's facts list): its state as the kit's state label, then
 * its counts, neutral numbers; open incidents add the tone's icon of their own shape, named in
 * words for a screen reader. Two pairs a row where the view has room.
 */
export function InstanceFacts({
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
    <Facts
      className="sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]"
      facts={[
        {
          id: "state",
          label: t("instanceDetail.kpiState"),
          value: <StateLabel state={status.state}>{status.label}</StateLabel>,
        },
        {
          id: "tasks",
          label: t("instanceDetail.kpiOpenTasks"),
          value: <span className="tabular-nums">{formatNumber(openTaskCount)}</span>,
        },
        {
          id: "incidents",
          label: t("instanceDetail.kpiOpenIncidents"),
          value: (
            // On the number's baseline, the icon centred beside it: the facts align on baselines.
            <AlarmCount alarm={openIncidentCount > 0 && "openIncidents"}>
              {formatNumber(openIncidentCount)}
            </AlarmCount>
          ),
        },
        {
          id: "variables",
          label: t("instanceDetail.kpiVariables"),
          value: <span className="tabular-nums">{formatNumber(variableCount)}</span>,
        },
      ]}
    />
  )
}
