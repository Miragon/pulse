import { useToolQuery } from "@miragon/mcp-toolkit-ui"
import { CAMUNDA7_WIDGET_ACTIONS_DATA, type Camunda7WidgetAction } from "../tool-names.js"

export interface WidgetActionsFeed {
  allowedActions?: string[]
  // #338
  modelTools?: string[]
}

// The key sits outside the `camunda7:` prefix on purpose: the answer is deployment config, and
// the cockpit's Refresh (`refreshCockpitData`) re-reads that namespace.
function useWidgetActionsQuery() {
  return useToolQuery<WidgetActionsFeed>(
    ["camunda7-widget-actions"],
    CAMUNDA7_WIDGET_ACTIONS_DATA,
    {},
  )
}

// Undefined until it answers, or on error.
export function useWidgetActionsFeed(): WidgetActionsFeed | undefined {
  return useWidgetActionsQuery().data
}

// "unknown": the call failed, or the host wires no in-widget tools/call (query idle without data).
export type ModelToolsAnswer = readonly string[] | "pending" | "unknown"

export function modelToolsAnswer(query: {
  data?: WidgetActionsFeed
  isError: boolean
  fetchStatus: string
}): ModelToolsAnswer {
  if (query.data?.modelTools) return query.data.modelTools
  if (query.isError || query.fetchStatus === "idle") return "unknown"
  return "pending"
}

export function useModelToolsAnswer(): ModelToolsAnswer {
  return modelToolsAnswer(useWidgetActionsQuery())
}

// A disallowed button is not rendered: the toolset is deployment-wide, so a disabled control raises a
// question the user cannot act on. Fails closed until the feed answers (a button may appear late,
// never vanish under the cursor). Widgets read this via `useEngineAction`, so write and gate travel together.
export function useCanRun(): (action: Camunda7WidgetAction) => boolean {
  const allowed = useWidgetActionsFeed()?.allowedActions
  return (action) => allowed?.includes(action) ?? false
}
