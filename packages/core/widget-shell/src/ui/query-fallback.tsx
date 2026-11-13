import type { ReactNode } from "react"
import { ErrorState, Skeleton, useLocale } from "@miragon/pulse-ui"
import { describeError, isPermanentError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { hasContent, LoadingStatus, RefreshRegion } from "./view-data-state.js"

/**
 * The error branch several widgets forgot, leaving them on an eternal skeleton; no Try again on a
 * permanent refusal. A first load shows its skeleton only after 400 ms. Handed the loaded
 * content (`children`) with `isLoading` false, it renders it, refreshed in place while
 * `refreshing` (aria-busy).
 */
export function QueryFallback({
  isError,
  error,
  onRetry,
  errorTitle,
  loadingText,
  skeleton,
  isLoading = true,
  refreshing = false,
  children,
}: {
  isError: boolean
  error?: unknown
  onRetry: () => void
  /** Heads an error the kit cannot classify. */
  errorTitle?: string
  loadingText?: string
  skeleton: ReactNode
  /** Whether the first load still runs; default `true` (rendered in place of content that is missing). */
  isLoading?: boolean
  /** A new read over the content on screen: its region turns busy, the content stays. */
  refreshing?: boolean
  /**
   * The loaded content, rendered once `isLoading` is false; `null` or `false` is content that is
   * missing, which the fallback stands in for.
   */
  children?: ReactNode
}) {
  const locale = useLocale()
  if (isError) {
    const described = describeError(error, locale, { fallbackTitle: errorTitle })
    return (
      <ErrorState
        title={described.title}
        description={described.hint}
        details={described.details ?? undefined}
        onRetry={isPermanentError(error) ? undefined : onRetry}
      />
    )
  }
  if (!isLoading && hasContent(children)) {
    return <RefreshRegion refreshing={refreshing}>{children}</RefreshRegion>
  }
  return <LoadingStatus text={loadingText ?? kitLabels(locale).loadingView} skeleton={skeleton} />
}

export function TableSkeleton() {
  return (
    <div className="rounded-md border p-3">
      <Skeleton className="mb-3 h-5 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
