import type { ReactNode } from "react"
import { cn, EmptyState, ErrorState, Skeleton, useLocale } from "@miragon/mcp-toolkit-ui"
import { describeError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"

/** The rough geometry of a widget body. */
function DefaultSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-24 w-full" />
    </>
  )
}

export function LoadingStatus({
  text,
  skeleton,
  className,
}: {
  text: string
  skeleton?: ReactNode
  className?: string
}) {
  return (
    <div role="status" className={cn("flex flex-col gap-3", className)}>
      <span className="sr-only">{text}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        {skeleton ?? <DefaultSkeleton />}
      </div>
    </div>
  )
}

/** Loading, error and no-data boundary; the retry is mandatory, a failed load is never a dead end. */
export function ViewDataState({
  loading,
  error,
  onRetry,
  emptyText,
  loadingText,
  skeleton,
  errorTitle,
  retryLabel,
  className,
}: {
  loading: boolean
  error: Error | null | undefined
  onRetry: () => void
  /** What is missing when the load finished without data ("No incident found"). */
  emptyText: string
  loadingText?: string
  /** Shown while loading, shaped like the result (default: a heading bar and a block). */
  skeleton?: ReactNode
  /** Title for an error the kit cannot classify (default: the locale's "Something went wrong"). */
  errorTitle?: string
  retryLabel?: string
  className?: string
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
        onRetry={onRetry}
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
  return <EmptyState className={className} title={emptyText} />
}
