import { shortId } from "@miragon/pulse-widget-shell/widgets"
import type { T } from "../../messages/use-t.js"
import type { TaskCompletion } from "./complete-task.js"
import type { TargetLine, WriteFeedback } from "./engine-action.js"

/** The business key is what people search for; else the short id. */
export function instanceName(id: string, businessKey?: string | null): string {
  return businessKey || shortId(id)
}

/** #322 U13: never a bare UUID that wraps over two lines. */
export function instanceTargetLines(
  t: T,
  id: string,
  businessKey?: string | null,
): [TargetLine, ...TargetLine[]] {
  const instance: TargetLine = [t("confirmDialog.instance"), shortId(id)]
  return businessKey ? [[t("confirmDialog.businessKey"), businessKey], instance] : [instance]
}

/** U9: in one place, so the same write says the same thing on every surface. */
export const writeFeedback = {
  jobRetry: (t: T, instance: string): WriteFeedback<unknown> => ({
    success: t("feedback.jobRetried", { instance }),
    failure: t("feedback.jobRetryFailed", { instance }),
  }),
  externalTaskRetry: (t: T, instance: string): WriteFeedback<unknown> => ({
    success: t("feedback.externalTaskRetried", { instance }),
    failure: t("feedback.externalTaskRetryFailed", { instance }),
  }),
  resolve: (t: T, instance: string): WriteFeedback<unknown> => ({
    success: t("feedback.incidentResolved", { instance }),
    failure: t("feedback.incidentResolveFailed", { instance }),
  }),
  cancel: (t: T, instance: string): WriteFeedback<unknown> => ({
    success: t("feedback.instanceCancelled", { instance }),
    failure: t("feedback.instanceCancelFailed", { instance }),
  }),
  suspension: (t: T, instance: string, suspend: boolean): WriteFeedback<unknown> =>
    suspend
      ? {
          success: t("feedback.instanceSuspended", { instance }),
          failure: t("feedback.instanceSuspendFailed", { instance }),
        }
      : {
          success: t("feedback.instanceActivated", { instance }),
          failure: t("feedback.instanceActivateFailed", { instance }),
        },
  variable: (t: T, name: string): WriteFeedback<unknown> => ({
    success: t("feedback.variableSaved", { name }),
    failure: t("feedback.variableSaveFailed", { name }),
  }),
  /** A delegated task is resolved back to its owner, not completed. */
  completeTask: (t: T, name: string): WriteFeedback<TaskCompletion> => ({
    success: (result) =>
      result?.outcome === "resolved" && result.assignee
        ? t("feedback.taskReturned", { name, owner: result.assignee })
        : t("feedback.taskCompleted", { name }),
    failure: t("feedback.taskCompleteFailed", { name }),
  }),
  settings: (t: T): WriteFeedback<unknown> => ({
    success: t("feedback.settingsSaved"),
    failure: t("feedback.settingsSaveFailed"),
  }),
}
