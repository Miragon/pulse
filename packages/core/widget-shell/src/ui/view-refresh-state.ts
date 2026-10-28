import type { ViewDataResult } from "@miragon/mcp-toolkit-ui/hooks"

export interface ViewRefreshState {
  /**
   * Set from the refetch's FIRST failed attempt, so a view gating writes on it
   * never offers them on an unconfirmed state through the backoff.
   */
  refreshError: Error | null
  refreshing: boolean
}

/** The one place that decides when shown data counts as unconfirmed. */
export function viewRefreshState(
  view: Pick<ViewDataResult<unknown>, "data" | "error" | "failureReason" | "isFetching">,
): ViewRefreshState {
  const shown = view.data !== null
  return {
    refreshError: shown ? (view.error ?? view.failureReason) : null,
    refreshing: shown && view.isFetching,
  }
}
