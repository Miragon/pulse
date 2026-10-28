import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** The toasts of `useEngineAction` (U9); the kit's `useActionFeedback` adds why and what to do. */
export const enFeedback: MessageCatalog = {
  "feedback.jobRetried": "Job for instance {instance} retried",
  "feedback.jobRetryFailed": "Couldn't retry the job for instance {instance}",
  "feedback.externalTaskRetried": "External task for instance {instance} retried",
  "feedback.externalTaskRetryFailed": "Couldn't retry the external task for instance {instance}",
  "feedback.incidentResolved": "Incident in instance {instance} marked as resolved",
  "feedback.incidentResolveFailed": "Couldn't mark the incident as resolved in instance {instance}",
  "feedback.instanceCancelled": "Instance {instance} cancelled",
  "feedback.instanceCancelFailed": "Couldn't cancel instance {instance}",
  "feedback.instanceSuspended": "Instance {instance} suspended",
  "feedback.instanceSuspendFailed": "Couldn't suspend instance {instance}",
  "feedback.instanceActivated": "Instance {instance} activated",
  "feedback.instanceActivateFailed": "Couldn't activate instance {instance}",
  "feedback.variableSaved": "Variable {name} saved",
  "feedback.variableSaveFailed": "Couldn't save variable {name}",
  "feedback.taskCompleted": "Task {name} completed",
  "feedback.taskReturned": "Task {name} handed back to {owner}",
  "feedback.taskCompleteFailed": "Couldn't complete task {name}",
  "feedback.settingsSaved": "Settings saved",
  "feedback.settingsSaveFailed": "Couldn't save the settings",
}
