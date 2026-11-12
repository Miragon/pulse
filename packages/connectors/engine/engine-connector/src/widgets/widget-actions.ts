import { ENGINE_WIDGET_ACTIONS_DATA, type EngineWidgetAction } from "../tool-names.js"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"

interface WidgetActionsFeed {
  allowedActions?: string[]
  /** The engines whose profile is read-only: no write runs there, whatever the toolset. */
  readOnlyEngines?: string[]
}

// The key sits outside the `engine:` prefix on purpose: the answer is deployment config, and
// the cockpit's Refresh (`refreshCockpitData`) re-reads that namespace. Undefined until it
// answers, or on error.
function useWidgetActions(): WidgetActionsFeed | undefined {
  return useToolQuery<WidgetActionsFeed>(["engine-widget-actions"], ENGINE_WIDGET_ACTIONS_DATA, {})
    .data
}

// A disallowed button is not rendered: the toolset is deployment-wide and a read-only profile
// engine-wide, so a disabled control raises a question the user cannot act on. Fails closed until
// the feed answers (a button may appear late, never vanish under the cursor). Widgets read this
// via `useEngineAction`, so write and gate travel together. `engine` is the engine the write goes
// to, a required argument: without one the write goes to the default engine, which may be the
// read-only one, so it stays closed while any engine's profile is read-only.
export function useCanRun(): (action: EngineWidgetAction, engine: string | undefined) => boolean {
  const feed = useWidgetActions()
  return (action, engine) => {
    if (!(feed?.allowedActions?.includes(action) ?? false)) return false
    const readOnly = feed?.readOnlyEngines ?? []
    return engine === undefined ? readOnly.length === 0 : !readOnly.includes(engine)
  }
}
