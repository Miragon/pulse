import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** Toasts von `useEngineAction` (U9); Grund und nächsten Schritt ergänzt `useActionFeedback`. */
export const deFeedback: MessageCatalog = {
  "feedback.jobRetried": "Job für Instanz {instance} neu eingeplant",
  "feedback.jobRetryFailed": "Job für Instanz {instance} konnte nicht neu eingeplant werden",
  "feedback.externalTaskRetried": "External Task für Instanz {instance} neu eingeplant",
  "feedback.externalTaskRetryFailed":
    "External Task für Instanz {instance} konnte nicht neu eingeplant werden",
  "feedback.incidentResolved": "Incident in Instanz {instance} als gelöst markiert",
  "feedback.incidentResolveFailed":
    "Incident in Instanz {instance} konnte nicht als gelöst markiert werden",
  "feedback.instanceCancelled": "Instanz {instance} abgebrochen",
  "feedback.instanceCancelFailed": "Instanz {instance} konnte nicht abgebrochen werden",
  "feedback.instanceSuspended": "Instanz {instance} ausgesetzt",
  "feedback.instanceSuspendFailed": "Instanz {instance} konnte nicht ausgesetzt werden",
  "feedback.instanceActivated": "Instanz {instance} aktiviert",
  "feedback.instanceActivateFailed": "Instanz {instance} konnte nicht aktiviert werden",
  "feedback.variableSaved": "Variable {name} gespeichert",
  "feedback.variableSaveFailed": "Variable {name} konnte nicht gespeichert werden",
  "feedback.taskCompleted": "Aufgabe {name} abgeschlossen",
  "feedback.taskReturned": "Aufgabe {name} an {owner} zurückgegeben",
  "feedback.taskCompleteFailed": "Aufgabe {name} konnte nicht abgeschlossen werden",
  "feedback.settingsSaved": "Einstellungen gespeichert",
  "feedback.settingsSaveFailed": "Einstellungen konnten nicht gespeichert werden",
}
