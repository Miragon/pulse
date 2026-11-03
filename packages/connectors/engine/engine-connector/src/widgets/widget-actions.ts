import { ENGINE_WIDGET_ACTIONS_DATA, type EngineWidgetAction } from "../tool-names.js"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"

interface WidgetActionsFeed {
  allowedActions?: string[]
}

// The key sits outside the `engine:` prefix on purpose: the answer is deployment config, and
// the cockpit's Refresh (`refreshCockpitData`) re-reads that namespace. Undefined until it
// answers, or on error.
function useAllowedActions(): string[] | undefined {
  return useToolQuery<WidgetActionsFeed>(["engine-widget-actions"], ENGINE_WIDGET_ACTIONS_DATA, {})
    .data?.allowedActions
}

// A disallowed button is not rendered: the toolset is deployment-wide, so a disabled control raises a
// question the user cannot act on. Fails closed until the feed answers (a button may appear late,
// never vanish under the cursor). Widgets read this via `useEngineAction`, so write and gate travel together.
export function useCanRun(): (action: EngineWidgetAction) => boolean {
  const allowed = useAllowedActions()
  return (action) => allowed?.includes(action) ?? false
}
