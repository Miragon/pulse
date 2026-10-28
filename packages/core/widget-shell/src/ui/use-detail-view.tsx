import type { ReactElement, ReactNode } from "react"
import { ErrorState, useLocale } from "@miragon/mcp-toolkit-ui"
import { useViewData, type UseViewDataOptions } from "@miragon/mcp-toolkit-ui/hooks"
import { describeError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { viewRefreshState } from "./view-refresh-state.js"
import { ViewDataState } from "./view-data-state.js"
import { WidgetShell } from "./widget-shell.js"

/**
 * The handed-in tool result SEEDS the feed query instead of switching it off,
 * so a write's invalidation, a Retry or a refresh re-reads a standalone view.
 */
const SEED = { initialDataMode: "seed" } as const satisfies UseViewDataOptions<unknown>

/**
 * `notice` reports a failed REFETCH over shown data, which may be stale.
 * `loadError` lets a section on a composed page hide itself when the feed's
 * tool is not on this server.
 */
export function useDetailView<TData>(opts: {
  initialData: TData | null | undefined
  /** Stable cache-key (e.g. ["camunda7:instance-detail", engine, id]). */
  key: ReadonlyArray<unknown>
  tool: string
  args: Record<string, unknown>
  ready: boolean
  emptyText: string
  loadingText?: string
  skeleton?: ReactNode
  retryText?: string
  /** Title of the stale-data notice (default: the active locale's "Couldn't refresh this view"). */
  refreshErrorTitle?: string
}): {
  data: TData | null
  guard: ReactElement | null
  notice: ReactElement | null
  refreshError: Error | null
  loadError: unknown
} {
  const locale = useLocale()
  const defaults = kitLabels(locale)
  const { initialData, key, tool, args, ready, emptyText, loadingText, skeleton, retryText } = opts
  const view = useViewData<TData>(initialData, key, tool, args, ready, SEED)
  const { data, loading, error, refetch } = view
  const retry = () => void refetch()
  const { refreshError } = viewRefreshState(view)
  const guard = data ? null : (
    <WidgetShell>
      <ViewDataState
        loading={loading}
        error={error}
        loadingText={loadingText}
        skeleton={skeleton}
        emptyText={emptyText}
        onRetry={retry}
        retryLabel={retryText}
      />
    </WidgetShell>
  )
  let notice: ReactElement | null = null
  if (refreshError) {
    const described = describeError(refreshError, locale)
    notice = (
      <ErrorState
        variant="inline"
        tone="warning"
        title={opts.refreshErrorTitle ?? defaults.refreshFailed}
        description={`${described.title}. ${defaults.refreshStale}`}
        details={described.details ?? undefined}
        onRetry={retry}
        retryLabel={retryText}
      />
    )
  }
  return { data, guard, notice, refreshError, loadError: data ? null : (error ?? null) }
}
