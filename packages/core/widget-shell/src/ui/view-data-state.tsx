import { useEffect, useState, type ReactNode } from "react"
import { cn, EmptyState, ErrorState, Skeleton, useLocale } from "@miragon/pulse-ui"
import { describeError, isPermanentError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"

/**
 * How long a load runs before its skeleton shows (the webview's rule): a quick answer replaces
 * nothing with its content, without a skeleton flashing up for a moment.
 */
export const SKELETON_DELAY_MS = 400

/** True once `delayMs` passed since the first render. */
function useElapsed(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])
  return elapsed
}

/** The rough geometry of a widget body. */
function DefaultSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-24 w-full" />
    </>
  )
}

/**
 * A load in progress: a polite status a screen reader reads at once, and the skeleton shaped
 * like the result only after {@link SKELETON_DELAY_MS}.
 */
export function LoadingStatus({
  text,
  skeleton,
  className,
}: {
  text: string
  skeleton?: ReactNode
  className?: string
}) {
  const showSkeleton = useElapsed(SKELETON_DELAY_MS)
  return (
    <div
      role="status"
      data-skeleton={showSkeleton}
      className={cn("flex flex-col gap-3", className)}
    >
      <span className="sr-only">{text}</span>
      {showSkeleton && (
        <div aria-hidden="true" className="flex flex-col gap-3">
          {skeleton ?? <DefaultSkeleton />}
        </div>
      )}
    </div>
  )
}

/**
 * Whether `children` draws anything: `undefined`, `null` and a boolean (`{rows.length > 0 && …}`)
 * are no content, so the boundary says what is missing instead of an empty busy region.
 */
export function hasContent(children: ReactNode): boolean {
  return children !== undefined && children !== null && typeof children !== "boolean"
}

/**
 * The loaded content, refreshed in place: it stays on screen while a new read runs, its region
 * busy (`aria-busy`) and silent; nothing blanks and nothing reflows.
 */
export function RefreshRegion({
  refreshing,
  className,
  children,
}: {
  refreshing: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div data-slot="view-data" aria-busy={refreshing || undefined} className={className}>
      {children}
    </div>
  )
}

/**
 * Loading, error and no-data boundary; the retry is mandatory, a failed load is never a dead end.
 * A permanent refusal (`isPermanentError`) shows no Try again: its hint names the way out. A
 * first load shows its skeleton only after 400 ms. Handed the loaded content (`children`), it
 * renders it once the load is done, refreshed in place while `refreshing` (aria-busy).
 */
export function ViewDataState({
  loading,
  error,
  onRetry,
  emptyText,
  loadingText,
  skeleton,
  errorTitle,
  retryLabel,
  refreshing = false,
  className,
  children,
}: {
  loading: boolean
  error: Error | null | undefined
  onRetry: () => void
  /** What is missing when the load finished without data ("No incident found"). */
  emptyText: string
  loadingText?: string
  /** Shown once a first load runs 400 ms, shaped like the result (default: a heading bar and a block). */
  skeleton?: ReactNode
  /** Title for an error the kit cannot classify (default: the locale's "Something went wrong"). */
  errorTitle?: string
  retryLabel?: string
  /** A new read over the content on screen: its region turns busy, the content stays. */
  refreshing?: boolean
  className?: string
  /** The loaded content; without it (or `null`, `false`) a finished load says `emptyText`. */
  children?: ReactNode
}) {
  const locale = useLocale()
  const defaults = kitLabels(locale)
  if (error) {
    const described = describeError(error, locale, { fallbackTitle: errorTitle })
    return (
      <ErrorState
        className={className}
        title={described.title}
        description={described.hint}
        details={described.details ?? undefined}
        onRetry={isPermanentError(error) ? undefined : onRetry}
        retryLabel={retryLabel}
      />
    )
  }
  if (loading) {
    return (
      <LoadingStatus
        text={loadingText ?? defaults.loadingView}
        skeleton={skeleton}
        className={className}
      />
    )
  }
  if (hasContent(children)) {
    return (
      <RefreshRegion refreshing={refreshing} className={className}>
        {children}
      </RefreshRegion>
    )
  }
  return <EmptyState className={className} title={emptyText} />
}
