import { EngineActionDialog } from "../lib/engine-action-dialog.js"
import type { InstanceActions } from "./use-instance-actions.js"

export function InstanceActionDialogs({ actions }: { actions: InstanceActions }) {
  return (
    <>
      <EngineActionDialog action={actions.cancel} />
      <EngineActionDialog action={actions.suspension} />
      <EngineActionDialog action={actions.recovery.resolve} />
    </>
  )
}
