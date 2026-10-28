import type { InstanceDetailData } from "../../view-models.js"
import { useT, type T } from "../../messages/use-t.js"
import { useEngineAction, type ActionConfirmation, type TargetLine } from "../lib/engine-action.js"
import { engineTargetLines, useEngineEnvironment } from "../lib/engine-context.js"
import { useIncidentRecovery } from "../process-incidents/use-incident-recovery.js"
import { instanceName, instanceTargetLines, writeFeedback } from "../lib/write-feedback.js"

interface SuspensionArgs extends Record<string, unknown> {
  processInstanceId: string
  suspended: boolean
  engine?: string
}

interface CancelArgs extends Record<string, unknown> {
  processInstanceId: string
  engine?: string
}

/** Where a write lands: the engine and its environment (#322 U4). */
interface WriteTarget {
  engineId: string | undefined
  environment: string | null
}

/** #322 U13: business key, then short id. */
function instanceLines(
  t: T,
  instance: InstanceDetailData["instance"],
  { engineId, environment }: WriteTarget,
): [TargetLine, ...TargetLine[]] {
  const lines = instanceTargetLines(t, instance.id, instance.businessKey)
  lines.push([t("confirmDialog.definition"), instance.definitionId])
  lines.push(...engineTargetLines(t, engineId, environment))
  return lines
}

function cancelConfirmation(
  t: T,
  instance: InstanceDetailData["instance"],
  where: WriteTarget,
): ActionConfirmation {
  return {
    title: t("instanceDetail.confirmCancelTitle"),
    description: t("instanceDetail.confirmCancelDescription"),
    target: instanceLines(t, instance, where),
    confirmLabel: t("instanceDetail.cancelInstance"),
    keepLabel: t("instanceDetail.keepInstance"),
    destructive: true,
  }
}

function suspensionConfirmation(
  t: T,
  suspend: boolean,
  instance: InstanceDetailData["instance"],
  where: WriteTarget,
): ActionConfirmation {
  const target = instanceLines(t, instance, where)
  return suspend
    ? {
        title: t("instanceDetail.confirmSuspendTitle"),
        description: t("instanceDetail.confirmSuspendDescription"),
        target,
        confirmLabel: t("instanceDetail.confirmSuspend"),
        keepLabel: t("instanceDetail.keepRunning"),
      }
    : {
        title: t("instanceDetail.confirmActivateTitle"),
        description: t("instanceDetail.confirmActivateDescription"),
        target,
        confirmLabel: t("instanceDetail.confirmActivate"),
        keepLabel: t("instanceDetail.keepSuspended"),
      }
}

/**
 * Writes are offered for the current state only: never on an ended or cancelled instance, nor
 * while a failed refetch leaves it `unconfirmed` (completing the last task makes the runtime read 404).
 */
export function useInstanceActions({
  engine,
  data,
  unconfirmed,
}: {
  engine?: string
  data: InstanceDetailData | null
  unconfirmed: boolean
}) {
  const t = useT()
  const instanceId = data?.instance.id ?? ""
  const current = !!data && !data.instance.ended && !unconfirmed
  // No reset: the runtime read after a cancel could only answer 404.
  const cancel = useEngineAction<CancelArgs>({
    tool: "camunda7_delete_process_instance",
    target: (args) => args.processInstanceId,
    available: current,
  })
  const cancelled = cancel.done.has(instanceId)
  const isActionable = current && !cancelled
  const suspension = useEngineAction<SuspensionArgs>({
    tool: "camunda7_set_process_instance_suspension",
    target: (args) => args.processInstanceId,
    resetOn: data,
    available: isActionable,
  })

  // Standalone has no `engine` prop; writes must target the data's engine, never the caller's default.
  const engineId = engine ?? data?.engineId
  const where: WriteTarget = { engineId, environment: useEngineEnvironment(engineId) }
  const recovery = useIncidentRecovery(engineId, { resetOn: data, available: isActionable })
  const isSuspended =
    suspension.done.get(instanceId)?.args.suspended ?? data?.instance.suspended ?? false

  // The early returns exist for the type system only.
  function requestSuspendToggle() {
    if (!data) return
    suspension.run(
      { processInstanceId: data.instance.id, suspended: !isSuspended, engine: engineId },
      {
        confirm: suspensionConfirmation(t, !isSuspended, data.instance, where),
        feedback: writeFeedback.suspension(
          t,
          instanceName(data.instance.id, data.instance.businessKey),
          !isSuspended,
        ),
      },
    )
  }

  function requestCancel() {
    if (!data) return
    cancel.run(
      { processInstanceId: data.instance.id, engine: engineId },
      {
        confirm: cancelConfirmation(t, data.instance, where),
        feedback: writeFeedback.cancel(
          t,
          instanceName(data.instance.id, data.instance.businessKey),
        ),
      },
    )
  }

  return {
    engineId,
    isSuspended,
    cancelled,
    isActionable,
    canCompleteTasks: isActionable && !isSuspended,
    canSuspend: suspension.allowed,
    canCancel: cancel.allowed,
    isMutatingInstance: suspension.pending() || cancel.pending(),
    recovery,
    suspension,
    cancel,
    requestSuspendToggle,
    requestCancel,
  }
}

export type InstanceActions = ReturnType<typeof useInstanceActions>
