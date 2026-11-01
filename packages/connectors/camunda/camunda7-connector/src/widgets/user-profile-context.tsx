import {
  modelContextText,
  type ToolSurface,
  HostModelContext,
} from "@miragon/pulse-widget-shell/widgets"
import { CAMUNDA7_SAVE_SETTINGS } from "../tool-names.js"
import { useHandOff, type ViewContext } from "./lib/hand-off.js"

// The model is never told about a write that would refuse.
export function describeProfile({
  canSave,
  allEnginesAllowed,
  allowedEngineCount,
}: {
  canSave: boolean
  allEnginesAllowed: boolean
  allowedEngineCount: number
}): ViewContext {
  return {
    summary: canSave
      ? "The operator is on camunda7's engine settings; they can be changed here or via the save tool."
      : "The operator is on camunda7's engine settings; they are read-only in this deployment.",
    facts: {
      availableEngines: allEnginesAllowed ? "all" : allowedEngineCount,
    },
    tools: ["camunda7_save_settings"],
  }
}

// The save tool only while `canSave`: a gateway deployment on `camunda7:operations` without OAuth
// registers it, yet every call refuses.
export function profileSurface(surface: ToolSurface, canSave: boolean): ToolSurface {
  return {
    has: (tool) =>
      tool === CAMUNDA7_SAVE_SETTINGS ? canSave && surface.has(tool) : surface.has(tool),
  }
}

export function ProfileModelContext({
  allowedEngineCount,
  canSave,
  allEnginesAllowed,
}: {
  allowedEngineCount: number
  canSave: boolean
  allEnginesAllowed: boolean
}) {
  const { surface } = useHandOff()
  const view = describeProfile({ canSave, allEnginesAllowed, allowedEngineCount })
  return (
    <HostModelContext
      content={modelContextText({ ...view, surface: profileSurface(surface, canSave) })}
    >
      {null}
    </HostModelContext>
  )
}
