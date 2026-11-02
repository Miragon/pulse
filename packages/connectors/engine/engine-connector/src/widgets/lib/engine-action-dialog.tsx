import { useState } from "react"

import { useT } from "../../messages/use-t.js"
import { ConfirmDialog } from "@miragon/pulse-widget-shell/widgets"
import type { EngineAction } from "./engine-action.js"

/** Stays open while pending and shows the failure; closes on success. */
export function EngineActionDialog<TArgs, TResult>({
  action,
}: {
  action: EngineAction<TArgs, TResult>
}) {
  const t = useT()
  const current = action.confirmation
  // Keeps its last content through the exit animation instead of flashing empty.
  const [shown, setShown] = useState(current)
  if (current !== null && current !== shown) setShown(current)
  const view = current ?? shown
  if (!view) return null
  const { spec } = view
  return (
    <ConfirmDialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) action.dismiss()
      }}
      title={spec.title}
      description={spec.description}
      target={spec.target}
      confirmLabel={spec.confirmLabel}
      keepLabel={spec.keepLabel}
      pendingLabel={t("confirmDialog.working")}
      destructive={spec.destructive}
      pending={action.pending(view.target)}
      error={action.error(view.target)}
      onConfirm={action.confirm}
    />
  )
}
