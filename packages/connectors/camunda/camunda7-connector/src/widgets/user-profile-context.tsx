import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import { modelContextText, type ToolSurface } from "@miragon/pulse-widget-shell/widgets"
import { CAMUNDA7_SAVE_SETTINGS } from "../tool-names.js"
import { useHandOff, type ViewContext } from "./lib/hand-off.js"

// The model is never told about a tool it lacks, nor about a write that would refuse.
export function describeProfile(
  form: { defaultDashboardId: string },
  {
    canSave,
    allEnginesAllowed,
    allowedEngineCount,
  }: {
    canSave: boolean
    allEnginesAllowed: boolean
    allowedEngineCount: number
  },
): ViewContext {
  return {
    summary: canSave
      ? "The operator is on camunda7's settings section (engines, dashboards); they can be changed here or via the save tool."
      : "The operator is on camunda7's settings section (engines, dashboards); they are read-only in this deployment.",
    ids: { defaultDashboardId: form.defaultDashboardId || undefined },
    facts: {
      availableEngines: allEnginesAllowed ? "all" : allowedEngineCount,
    },
    tools: ["camunda7_save_settings", "load-dashboard"],
  }
}

// The save tool only while `canSave`: a gateway deployment on `camunda7:operations` without OAuth
// registers it, yet every call refuses. `load-dashboard` only once `list-dashboards` answered.
export function profileSurface(
  surface: ToolSurface,
  { canSave, dashboardsAnswered }: { canSave: boolean; dashboardsAnswered: boolean },
): ToolSurface {
  return {
    has: (tool) => {
      if (tool === "load-dashboard") return dashboardsAnswered
      if (tool === CAMUNDA7_SAVE_SETTINGS) return canSave && surface.has(tool)
      return surface.has(tool)
    },
  }
}

export function ProfileModelContext({
  form,
  canSave,
  allEnginesAllowed,
  dashboardsAnswered,
}: {
  form: { defaultDashboardId: string; allowedEngineIds: string[] }
  canSave: boolean
  allEnginesAllowed: boolean
  dashboardsAnswered: boolean
}) {
  const { surface } = useHandOff()
  const view = describeProfile(form, {
    canSave,
    allEnginesAllowed,
    allowedEngineCount: form.allowedEngineIds.length,
  })
  return (
    <HostModelContext
      content={modelContextText({
        ...view,
        surface: profileSurface(surface, { canSave, dashboardsAnswered }),
      })}
    >
      {null}
    </HostModelContext>
  )
}
