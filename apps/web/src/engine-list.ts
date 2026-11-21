import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"

/** The engine list, `engine_list_engines`: the one read of the frame, which a screen shares. */
const ENGINE_LIST = "engine_list_engines"

/**
 * The engine list's cache key: the embedded cockpit's own (`useToolQuery(["engine:engines"], …)`),
 * so the navigation, a screen and the cockpit share one read per page view.
 */
const ENGINE_LIST_KEY = ["engine:engines"] as const

/**
 * What the page reads of the engine list: the engines with their dialect, the refused profiles
 * with the server's reason (keys only, never a value), the boards, each left out where the answer
 * names none.
 */
export interface ListedEngines {
  readonly engines?: ReadonlyArray<{ id: string; environment?: string; dialect?: string }>
  readonly refused?: ReadonlyArray<{ id: string; environment?: string; reason?: string }>
  readonly boards?: ReadonlyArray<{ id: string; title: string }>
}

/** The engine list, read once per page view under the cockpit's own cache key. */
export function useEngineList() {
  return useToolQuery<ListedEngines>(ENGINE_LIST_KEY, ENGINE_LIST, {})
}
