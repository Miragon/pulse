import type { ReactElement, ReactNode } from "react"
import { StatusStrip, useLocale, WidgetHeader } from "@miragon/pulse-ui"
import { RefreshCw } from "lucide-react"
import { describeError, isPermanentError, isSessionEnded } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { useViewData } from "./tool-query.js"
import { viewRefreshState } from "./view-refresh-state.js"
import { ViewDataState } from "./view-data-state.js"
import { WidgetShell } from "./widget-shell.js"

/**
 * `notice` reports a failed REFETCH over shown data, which may be stale: a `StatusStrip` for the
 * view's header, docked under its bar, with Try again unless the failure is a refusal no retry
 * changes. It says what happened in the kit's words; the raw engine text waits under its Details.
 * A page's ended session gets none (`isSessionEnded`): the page's frame says it.
 * `loadError` lets a section on a composed page hide itself when the feed's tool is not on this
 * server. `guard` keeps the view's `title` in its bar while the view loads, fails or finds
 * nothing, so the page keeps its one heading (and the document its title) through every state.
 */
export function useDetailView<TData>(opts: {
  initialData: TData | null | undefined
  /** Stable cache-key (e.g. ["engine:instance-detail", engine, id]). */
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
  /** The view's title in the guard's bar, what is known before its data: none without it. */
  title?: string
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
  // The handed-in result SEEDS the feed: a write's invalidation or a Retry re-reads the view.
  const view = useViewData<TData>(initialData, key, tool, args, ready)
  const { data, loading, error, refetch } = view
  const retry = () => void refetch()
  const { refreshError } = viewRefreshState(view)
  const guard = data ? null : (
    <WidgetShell header={opts.title && <WidgetHeader title={opts.title} />}>
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
  // A page's ended session is its frame's to say, once: the view keeps what it showed, silently.
  if (refreshError && !isSessionEnded(refreshError)) {
    const described = describeError(refreshError, locale)
    notice = (
      <StatusStrip
        tone="warning"
        title={opts.refreshErrorTitle ?? defaults.refreshFailed}
        detail={`${described.title}. ${defaults.refreshStale}`}
        details={described.details ?? undefined}
        // A refusal no retry changes (`isPermanentError`) offers none here either.
        actions={
          isPermanentError(refreshError)
            ? []
            : [{ label: retryText ?? defaults.retry, icon: RefreshCw, onClick: retry }]
        }
      />
    )
  }
  return { data, guard, notice, refreshError, loadError: data ? null : (error ?? null) }
}
