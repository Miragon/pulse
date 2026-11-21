import { isPermanentError, useToolQuery } from "@miragon/pulse-widget-shell/widgets"

/** The engine list, `engine_list_engines`: the one read of the frame, which a screen shares. */
const ENGINE_LIST = "engine_list_engines"

/**
 * The engine list's cache key: the embedded cockpit's own (`useToolQuery(["engine:engines"], …)`),
 * so the navigation, a screen and the cockpit share one read per page view.
 */
const ENGINE_LIST_KEY = ["engine:engines"] as const

/**
 * What the page reads of the engine list: the engines with their dialect, the refused profiles
 * with the server's reason (keys only, never a value), the boards with the engines each names, the
 * board files that give no board with their count of problems, each left out where the answer
 * names none.
 */
export interface ListedEngines {
  readonly engines?: ReadonlyArray<{ id: string; environment?: string; dialect?: string }>
  readonly refused?: ReadonlyArray<{ id: string; environment?: string; reason?: string }>
  readonly boards?: ReadonlyArray<{ id: string; title: string; engines: readonly string[] }>
  readonly refusedBoards?: ReadonlyArray<{ id: string; problems: number }>
}

/**
 * The server's refusal of a refused profile's calls in the server's words (the engine module's
 * `ENGINE_PROFILE_REFUSED`, as its cockpit says it without a read), from the reason the engine list
 * names: the page reads nothing of such an engine and words the refusal as the server would (the
 * kit's `profileRefused`), the server's own text under Details.
 */
export function refusalOf(engine: string, reason: string | undefined): Error {
  const why = reason === undefined ? "" : ` ${reason}`
  return new Error(
    `[ENGINE_PROFILE_REFUSED] Engine "${engine}" is configured, but its profile cannot be used:${why} Ask whoever runs this server to fix it.`,
  )
}

/**
 * The engine list, read once per page view under the cockpit's own cache key: a screen that mounts
 * reads it again where it went stale, never where a read met a refusal no retry changes (a page's
 * ended session), which the frame's notice says once.
 */
export function useEngineList() {
  return useToolQuery<ListedEngines>(
    ENGINE_LIST_KEY,
    ENGINE_LIST,
    {},
    {
      refetchOnMount: (query) => query.state.error === null || !isPermanentError(query.state.error),
    },
  )
}
