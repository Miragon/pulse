import { incidentRecovery } from "@miragon/pulse-c7-core"

export interface RecoveryTarget {
  readonly resource: "/job" | "/external-task"
  readonly id: string
}

export interface RecoverableIncident {
  readonly incidentType: string
  readonly configuration?: string | undefined
}

export class RecoveryTargets {
  static of(incident: RecoverableIncident): RecoveryTarget | undefined {
    const recovery = incidentRecovery(incident)
    if (recovery.action === "retry-job") {
      return { resource: "/job", id: recovery.jobId }
    }
    if (recovery.action === "retry-external-task") {
      return { resource: "/external-task", id: recovery.externalTaskId }
    }
    return undefined
  }
}
