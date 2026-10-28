import type { ReactNode } from "react"
import { ErrorState, Skeleton, useLocale } from "@miragon/mcp-toolkit-ui"
import { describeError } from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { LoadingStatus } from "./view-data-state.js"

/** The error branch several widgets forgot, leaving them on an eternal skeleton. */
export function QueryFallback({
  isError,
  error,
  onRetry,
  errorTitle,
  loadingText,
  skeleton,
}: {
  isError: boolean
  error?: unknown
  onRetry: () => void
  /** Heads an error the kit cannot classify. */
  errorTitle?: string
  loadingText?: string
  skeleton: ReactNode
}) {
  const locale = useLocale()
  if (isError) {
    const described = describeError(error, locale, { fallbackTitle: errorTitle })
    return (
      <ErrorState
        title={described.title}
        description={described.hint}
        details={described.details ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  return <LoadingStatus text={loadingText ?? kitLabels(locale).loadingView} skeleton={skeleton} />
}

export function TableSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <Skeleton className="mb-3 h-5 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
