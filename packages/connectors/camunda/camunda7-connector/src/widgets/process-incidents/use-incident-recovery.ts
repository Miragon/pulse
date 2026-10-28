import type { IncidentInstance } from "../../view-models.js"
import { useT, type T } from "../../messages/use-t.js"
import { recoveryOf } from "../lib/incident-recovery.js"
import { useEngineAction, type ActionConfirmation, type TargetLine } from "../lib/engine-action.js"
import { engineTargetLines, useEngineEnvironment } from "../lib/engine-context.js"
import { instanceName, instanceTargetLines, writeFeedback } from "../lib/write-feedback.js"

export type RowAction = "resolve" | "retry"

export type RecoverableIncident = Pick<
  IncidentInstance,
  "id" | "incidentType" | "processInstanceId" | "recovery"
> &
  Partial<Pick<IncidentInstance, "businessKey">>

interface ResolveArgs extends Record<string, unknown> {
  incidentId: string
  engine?: string
}

interface JobRetryArgs extends Record<string, unknown> {
  jobId: string
  retries: number
  engine?: string
}

interface ExternalTaskRetryArgs extends Record<string, unknown> {
  externalTaskId: string
  retries: number
  engine?: string
}

/** #322 U13, U4: a write on prod says so before it runs. */
export function resolveConfirmation(
  t: T,
  incident: RecoverableIncident,
  engineId: string | undefined,
  environment: string | null = null,
): ActionConfirmation {
  const lines: TargetLine[] = [
    [t("confirmDialog.incidentType"), incident.incidentType],
    ...instanceTargetLines(t, incident.processInstanceId, incident.businessKey),
    ...engineTargetLines(t, engineId, environment),
  ]
  return {
    title: t("confirmDialog.resolveTitle"),
    description: t("confirmDialog.resolveDescription"),
    target: [[t("confirmDialog.incident"), incident.id], ...lines],
    confirmLabel: t("confirmDialog.resolveConfirm"),
    keepLabel: t("confirmDialog.resolveKeep"),
  }
}

/**
 * The engine decides the remedy (`recovery`): built-in types refuse resolve with a 400, so they
 * offer Retry. Success marks drop on `resetOn`, since only fresh data can say a row is cleared.
 */
export function useIncidentRecovery(
  engineId: string | undefined,
  { resetOn, available = true }: { resetOn: unknown; available?: boolean },
) {
  const t = useT()
  const environment = useEngineEnvironment(engineId)
  const resolve = useEngineAction<ResolveArgs>({
    tool: "camunda7_resolve_incident",
    target: (args) => args.incidentId,
    resetOn,
    available,
  })
  const jobRetry = useEngineAction<JobRetryArgs>({
    tool: "camunda7_set_job_retries",
    target: (args) => args.jobId,
    resetOn,
    available,
  })
  const taskRetry = useEngineAction<ExternalTaskRetryArgs>({
    tool: "camunda7_set_external_task_retries",
    target: (args) => args.externalTaskId,
    resetOn,
    available,
  })

  function remedyOf(incident: RecoverableIncident, jobId?: string | null) {
    const recovery = recoveryOf(incident, jobId)
    const instance = instanceName(incident.processInstanceId, incident.businessKey)
    switch (recovery.action) {
      case "resolve":
        return {
          kind: "resolve" as const,
          action: resolve,
          target: incident.id,
          start: () =>
            resolve.run(
              { incidentId: incident.id, engine: engineId },
              {
                confirm: resolveConfirmation(t, incident, engineId, environment),
                feedback: writeFeedback.resolve(t, instance),
              },
            ),
        }
      case "retry-job":
        return {
          kind: "retry" as const,
          action: jobRetry,
          target: recovery.jobId,
          start: () =>
            jobRetry.run(
              { jobId: recovery.jobId, retries: 1, engine: engineId },
              { feedback: writeFeedback.jobRetry(t, instance) },
            ),
        }
      case "retry-external-task":
        return {
          kind: "retry" as const,
          action: taskRetry,
          target: recovery.externalTaskId,
          start: () =>
            taskRetry.run(
              { externalTaskId: recovery.externalTaskId, retries: 1, engine: engineId },
              { feedback: writeFeedback.externalTaskRetry(t, instance) },
            ),
        }
      default:
        return null
    }
  }

  return {
    resolve,
    /** Null when the incident type, toolset or state offers none. */
    actionFor(incident: RecoverableIncident, jobId?: string | null): RowAction | null {
      const remedy = remedyOf(incident, jobId)
      return remedy?.action.allowed ? remedy.kind : null
    },
    /** Until the feed refetches. */
    isDone(incident: RecoverableIncident, jobId?: string | null): boolean {
      const remedy = remedyOf(incident, jobId)
      return remedy !== null && remedy.action.done.has(remedy.target)
    },
    isPending(incident: RecoverableIncident, jobId?: string | null): boolean {
      const remedy = remedyOf(incident, jobId)
      return remedy !== null && remedy.action.pending(remedy.target)
    },
    errorOf(incident: RecoverableIncident, jobId?: string | null): string | null {
      const remedy = remedyOf(incident, jobId)
      return remedy ? remedy.action.error(remedy.target) : null
    },
    /** Resolve asks first, Retry runs at once. */
    act(incident: RecoverableIncident, jobId?: string | null) {
      remedyOf(incident, jobId)?.start()
    },
  }
}

export type IncidentRecoveryState = ReturnType<typeof useIncidentRecovery>
