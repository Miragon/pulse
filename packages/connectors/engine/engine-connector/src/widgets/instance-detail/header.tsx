import {
  FreshnessStamp,
  Button,
  Icon,
  StateLabel,
  StatusBadge,
  SITUATION_TONES,
  WidgetHeader,
  type StateLabelState,
  type ToneVariant,
  VersionChip,
  formatClock,
  formatInstant,
  formatNumber,
  shortId,
} from "@miragon/pulse-ui"
import { HandOffButton, IdText } from "@miragon/pulse-widget-shell/widgets"
import { Ban, CornerLeftUp, Pause, Play, Workflow } from "lucide-react"

import type { InstanceDetailData } from "../../view-models.js"
import { type T, useT } from "../../messages/use-t.js"
import { useHandOff, useHandOffsShown, type HandOff } from "../lib/hand-off.js"
import { definitionVersionOf } from "../lib/identity.js"

export interface InstanceStatus {
  label: string
  tone: ToneVariant
  /** The kit's state, whose icon a `StateLabel` draws. */
  state: StateLabelState
}

/** The instance's state in words, its tone and its kit state, for its bar. */
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

interface InstanceActionProps {
  isActionable: boolean
  /** Opens the instance that called this one; absent for an instance nothing called. */
  onOpenCaller?: () => void
  /** Opens the instance's process in the cockpit; absent while its key is unknown. */
  onOpenProcess?: () => void
  onRequestSuspendToggle?: () => void
  onRequestCancel?: () => void
}

/**
 * Whether the bar holds an action: the way to the caller or the process, a write on a live
 * instance, or a hand-off the host shows. With none of them it has no action group.
 */
function hasInstanceActions(
  {
    isActionable,
    onOpenCaller,
    onOpenProcess,
    onRequestSuspendToggle,
    onRequestCancel,
  }: InstanceActionProps,
  handOffs: boolean,
): boolean {
  const writes =
    isActionable && (onRequestSuspendToggle !== undefined || onRequestCancel !== undefined)
  return onOpenCaller !== undefined || onOpenProcess !== undefined || writes || handOffs
}

/**
 * The instance's state and, while it has any, its open incidents: a count in the bar is a state
 * label (its tone's icon, the number in the foreground), so an inline card shows the incidents
 * without its tabs, which lie below the diagram. In a bar under 28rem (a phone-width chat) the
 * count shows its icon alone, its words read out and in its title, so the title keeps its room.
 */
function InstanceBadge({
  status,
  openIncidentCount,
}: {
  status: InstanceStatus
  openIncidentCount: number
}) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-2.5">
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      {openIncidentCount > 0 && (
        <StateLabel state="incident" iconOnlyBelow="md">
          {t("instanceDetail.openIncidents", { count: formatNumber(openIncidentCount) })}
        </StateLabel>
      )}
    </span>
  )
}

/** When it started, a time without seconds (its day on another day), the whole instant in its title. */
function StartedFact({ startTime }: { startTime: string }) {
  const t = useT()
  return (
    <span title={formatInstant(startTime)} className="tabular-nums">
      {t("instanceDetail.started", { time: formatClock(startTime, { seconds: false }) })}
    </span>
  )
}

/** The caller by its short id, as the webview's bar links it; its name says where it goes. */
function OpenCallerButton({
  callerInstanceId,
  onOpen,
}: {
  callerInstanceId: string
  onOpen: () => void
}) {
  const t = useT()
  const label = t("instanceDetail.openCaller", { id: shortId(callerInstanceId) })
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <Icon icon={CornerLeftUp} />
      {shortId(callerInstanceId)}
    </Button>
  )
}

/** What the bar knows about the instance: its process, its id beside a business key, its start. */
function InstanceBarFacts({
  instance,
  processName,
  startTime,
}: {
  instance: InstanceDetailData["instance"]
  processName: string | null
  startTime: string | null
}) {
  const t = useT()
  const version = definitionVersionOf(instance.definitionId)
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {processName ?? t("instanceDetail.title")}
        {version !== null && <VersionChip version={version} />}
      </span>
      {instance.businessKey && <IdText value={instance.id} />}
      {startTime && <StartedFact startTime={startTime} />}
    </>
  )
}

interface InstanceHeaderActions extends InstanceActionProps {
  instance: InstanceDetailData["instance"]
  callerInstanceId: string | null
  engineId?: string
  activeActivityIds: string[]
  incidentActivityIds: string[]
  isSuspended: boolean
  isMutatingInstance: boolean
}

/**
 * The bar's one group: the ways to the caller and the process first (the meta line names the
 * process, facts only), then the writes on a live instance, then the chat.
 */
function InstanceActions({
  instance,
  callerInstanceId,
  engineId,
  activeActivityIds,
  incidentActivityIds,
  isSuspended,
  isActionable,
  isMutatingInstance,
  onOpenCaller,
  onOpenProcess,
  onRequestSuspendToggle,
  onRequestCancel,
}: InstanceHeaderActions) {
  const t = useT()
  const { ask } = useHandOff()
  return (
    <>
      {onOpenCaller && callerInstanceId && (
        <OpenCallerButton callerInstanceId={callerInstanceId} onOpen={onOpenCaller} />
      )}
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
          diagnoseInstanceHandOff({ instance, engineId, activeActivityIds, incidentActivityIds }),
        )}
      />
    </>
  )
}

export function InstanceHeader({
  processName,
  status,
  openIncidentCount,
  startTime,
  fetchedAt,
  ...actions
}: InstanceHeaderActions & {
  processName: string | null
  status: InstanceStatus
  /** The open incidents on screen: the engine's total minus what this view resolved. */
  openIncidentCount: number
  startTime: string | null
  /** When the server read the instance; none in an older payload, which shows no stamp. */
  fetchedAt?: string
}) {
  const handOffs = useHandOffsShown()
  const { instance } = actions
  return (
    <WidgetHeader
      badge={<InstanceBadge status={status} openIncidentCount={openIncidentCount} />}
      // The instance by its ONE label: its business key, else its id once, short and copyable
      // (#322 U13, as the webview's bar).
      title={instance.businessKey || <IdText value={instance.id} />}
      sub={<InstanceBarFacts instance={instance} processName={processName} startTime={startTime} />}
      actions={hasInstanceActions(actions, handOffs) && <InstanceActions {...actions} />}
      // When the server read the instance, once at the bar's end, as on every route: the state its
      // writes act on.
      freshness={<FreshnessStamp at={fetchedAt} />}
    />
  )
}
