import { useEffect, useState, type ReactNode } from "react"
import {
  buttonVariants,
  cn,
  EmptyState,
  ErrorState,
  Skeleton,
  useLocale,
  useUiMessages,
  type StateHeadingLevel,
} from "@miragon/pulse-ui"
import { House } from "lucide-react"
import {
  describeError,
  isPermanentError,
  isSessionEnded,
  leadsToStartPage,
} from "./describe-error.js"
import { kitLabels } from "./kit-labels.js"
import { useErrorWords, useStartPage } from "./view-host.js"

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
 * The way from a page's refused start to its start page (`href`, the page's `startPage`), in the
 * kit's words, beside the words that lead there: a failure's state puts it there, and so does a
 * page that words such a refusal itself (the web app's engine the server does not configure).
 */
export function StartPageLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
      <House aria-hidden="true" />
      {kitLabels(useLocale()).toStartPage}
    </a>
  )
}

/**
 * A load's failure in the kit's words: the status box, the raw text under Details, Try again
 * unless no retry changes it (`isPermanentError`), and on a page with a start page the link there
 * where its words lead (`leadsToStartPage`). A page's ended session is its frame's to say, once
 * (`isSessionEnded`): here a quiet line that the content is missing, no box and no session words.
 */
export function FailureState({
  error,
  onRetry,
  title,
  titleAs,
  retryLabel,
  className,
}: {
  error: unknown
  onRetry: () => void
  /** Heads a failure the kit cannot classify, and the quiet line of an ended session. */
  title?: string
  titleAs?: StateHeadingLevel
  retryLabel?: string
  className?: string
}) {
  const locale = useLocale()
  const words = useErrorWords()
  const startPage = useStartPage()
  const { common } = useUiMessages()
  if (isSessionEnded(error)) {
    return (
      <EmptyState
        className={className}
        title={title ?? common.loadFailed}
        titleAs={titleAs ?? "p"}
      />
    )
  }
  const described = describeError(error, locale, { fallbackTitle: title, ...words })
  const home = startPage !== undefined && leadsToStartPage(described.kind)
  return (
    <ErrorState
      className={className}
      title={described.title}
      titleAs={titleAs}
      description={described.hint}
      details={described.details ?? undefined}
      onRetry={isPermanentError(error) ? undefined : onRetry}
      retryLabel={retryLabel}
      actions={home ? <StartPageLink href={startPage} /> : undefined}
    />
  )
}

/**
 * Loading, error and no-data boundary; the retry is mandatory, a failed load is never a dead end.
 * A permanent refusal (`isPermanentError`) shows no Try again: its hint names the way out, and a
 * page's ended session only a quiet line (`FailureState`). A
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
  errorTitleAs,
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
  /** The error's heading element (default the status box's `h2`): `h1` where it is the page's one state. */
  errorTitleAs?: StateHeadingLevel
  /** A new read over the content on screen: its region turns busy, the content stays. */
  refreshing?: boolean
  className?: string
  /** The loaded content; without it (or `null`, `false`) a finished load says `emptyText`. */
  children?: ReactNode
}) {
  const defaults = kitLabels(useLocale())
  if (error) {
    return (
      <FailureState
        error={error}
        onRetry={onRetry}
        title={errorTitle}
        titleAs={errorTitleAs}
        retryLabel={retryLabel}
        className={className}
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
