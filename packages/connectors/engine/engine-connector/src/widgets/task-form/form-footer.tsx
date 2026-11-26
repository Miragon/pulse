import { Alert, AlertDescription, Button, Icon } from "@miragon/pulse-ui"
import { Plus } from "lucide-react"

import { useT } from "../../messages/use-t.js"
import type { CompleteTaskAction } from "../lib/complete-task.js"
import { WriteError } from "../lib/write-error.js"

function CompleteButton({ action, taskId }: { action: CompleteTaskAction; taskId: string }) {
  const t = useT()
  if (!action.allowed) return null
  const pending = action.pending(taskId)
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t("taskForm.completing") : t("taskForm.complete")}
    </Button>
  )
}

/** The form's actions: a variable to add by hand, then Cancel and Complete. */
export function FormActions({
  action,
  taskId,
  onAdd,
  onCancel,
}: {
  action: CompleteTaskAction
  taskId: string
  onAdd: () => void
  onCancel?: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
        <Icon icon={Plus} />
        {t("taskForm.addVariable")}
      </Button>
      <div className="flex items-center gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("taskForm.cancel")}
          </Button>
        )}
        <CompleteButton action={action} taskId={taskId} />
      </div>
    </div>
  )
}

/** What the last send came to. */
export interface FormOutcomeProps {
  /** A delegated task went back to its owner and stays open: never shown as completed. */
  resolvedTo: { owner: string | null } | null
  /** The form's own check: an entry it cannot take. */
  submitError: string | null
  /** The engine's answer, apart from the form's own check: worded, its text under "Details". */
  writeError: Error | null
}

/** What the last send came to: the task back with its owner, an entry refused, the engine's error. */
export function FormOutcome({ resolvedTo, submitError, writeError }: FormOutcomeProps) {
  const t = useT()
  return (
    <>
      {resolvedTo && (
        <Alert role="status">
          <AlertDescription>
            {t("taskForm.resolved", { owner: resolvedTo.owner ?? "—" })}
          </AlertDescription>
        </Alert>
      )}
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      <WriteError error={writeError} />
    </>
  )
}
