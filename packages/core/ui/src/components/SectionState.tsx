import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { SKELETON_DELAY_MS, useElapsed } from "../hooks/use-elapsed.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import type { SectionFailure } from "../locale/page-errors.js"
import { Skeleton } from "../primitives/skeleton.js"
import type { StateHeadingLevel } from "./EmptyState.js"
import { ErrorState } from "./ErrorState.js"

/** A section's read as `SectionState` shows it. */
export interface SectionStateValue<T> {
  /**
   * A read runs: over data or a failure on screen the region turns busy and they stay. Without
   * either the section waits for its first read whatever this says.
   */
  readonly loading?: boolean
  /** The last read's failure in words (`describePageError`, your own); none after a good read. */
  readonly error?: SectionFailure | null
  /**
   * The data of the last good read, kept while a later read runs or fails: `undefined` before
   * the first good read, `null` for a read that found nothing.
   */
  readonly data?: T | null
}

export interface SectionStateProps<T> {
  readonly state: SectionStateValue<T>
  /** Reads the section again: the failure's Try again (none for a `permanent` one). */
  readonly onRetry: () => void
  /** The section's skeleton, in the geometry of the loaded content (default: a 96 px block). */
  readonly skeleton?: ReactNode
  /** What a read that found nothing shows (`TableEmptyState`, `EmptyState`). */
  readonly empty?: ReactNode
  /** Whether read data counts as nothing found, so `empty` shows. Default: `null` or `[]`. */
  readonly isEmpty?: (data: T) => boolean
  /** The failure's title element. Default `"p"`: the section's own heading stays its one. */
  readonly errorTitleAs?: StateHeadingLevel
  readonly className?: string
  /** The loaded content. */
  readonly children: (data: T) => ReactNode
}

/** A failure a section reports to its group: what it says, where it stands and its retry. */
interface ReportedFailure {
  /** Identical words make identical failures. */
  readonly key: string
  /** The section's root: its place in the document decides who says the failure. */
  readonly element: HTMLElement
  readonly retry: () => void
}

/** The sections failing alike, by their failure's key, in document order: the first says it. */
type Alike = ReadonlyMap<string, readonly { readonly id: string; readonly retry: () => void }[]>

interface SectionStateGroupValue {
  readonly alike: Alike
  readonly report: (id: string, failure: ReportedFailure | undefined) => void
}

const SectionStateGroupContext = createContext<SectionStateGroupValue | null>(null)

/** `Node.DOCUMENT_POSITION_FOLLOWING`, without a DOM global at import time. */
const FOLLOWING = 4

/** Earlier in the document first (two sections never share a root). */
function documentOrder(a: ReportedFailure, b: ReportedFailure): number {
  return a.element.compareDocumentPosition(b.element) & FOLLOWING ? -1 : 1
}

function alikeOf(failures: ReadonlyMap<string, ReportedFailure>): Alike {
  const byKey = new Map<string, [string, ReportedFailure][]>()
  for (const entry of failures) {
    const same = byKey.get(entry[1].key)
    if (same === undefined) byKey.set(entry[1].key, [entry])
    else same.push(entry)
  }
  return new Map(
    [...byKey].map(([key, entries]) => [
      key,
      entries
        .sort(([, a], [, b]) => documentOrder(a, b))
        .map(([id, failure]) => ({ id, retry: failure.retry })),
    ]),
  )
}

export interface SectionStateGroupProps {
  /** The page's sections, at any depth. */
  readonly children: ReactNode
}

/**
 * The sections of a page that say a shared failure once: of the `SectionState`s under it that
 * fail with the same words, the first in the document shows the failure, the others a quiet line
 * that they were not read for the same reason, and the first one's Try again reads all of them
 * again. Without a group every section says its own failure.
 */
export function SectionStateGroup({ children }: SectionStateGroupProps) {
  const [failures, setFailures] = useState<ReadonlyMap<string, ReportedFailure>>(() => new Map())
  const report = useCallback((id: string, failure: ReportedFailure | undefined) => {
    // A section reports a failure once and takes it back before it reports another.
    setFailures((last) => {
      const next = new Map(last)
      if (failure === undefined) next.delete(id)
      else next.set(id, failure)
      return next
    })
  }, [])
  const value = useMemo(() => ({ alike: alikeOf(failures), report }), [failures, report])
  return (
    <SectionStateGroupContext.Provider value={value}>{children}</SectionStateGroupContext.Provider>
  )
}

/** The failure's key: its words, so two sections that would say the same say it once. */
function failureKey(failure: SectionFailure): string {
  return JSON.stringify([failure.title, failure.hint, failure.details, failure.permanent])
}

/**
 * A section's failure in its group: whether a section before it says it already (`repeated`)
 * and the retry its Try again runs, every alike section's when it speaks for several.
 */
function useSaidOnce(
  ref: RefObject<HTMLDivElement | null>,
  failure: SectionFailure | undefined,
  onRetry: () => void,
): { repeated: boolean; retry: () => void } {
  const group = useContext(SectionStateGroupContext)
  const id = useId()
  const latest = useRef(onRetry)
  useLayoutEffect(() => {
    latest.current = onRetry
  })
  const key = failure === undefined ? undefined : failureKey(failure)
  const report = group?.report
  // Reported before the browser paints, so sections failing alike never say it twice for a frame.
  useLayoutEffect(() => {
    const element = ref.current
    if (report === undefined || key === undefined || element === null) return undefined
    report(id, { key, element, retry: () => latest.current() })
    return () => report(id, undefined)
  }, [report, id, key, ref])
  const alike = key === undefined ? undefined : group?.alike.get(key)
  if (alike === undefined || alike.length < 2) return { repeated: false, retry: onRetry }
  return {
    repeated: alike[0]?.id !== id,
    retry: () => {
      for (const section of alike) section.retry()
    },
  }
}

/**
 * Keeps keyboard focus in the section across its Try again (WCAG 2.4.3): the button goes once the
 * read succeeds, which would drop focus to the document, so the section's region takes it, unless
 * the reader moved it elsewhere meanwhile.
 */
function useFocusKeptOnRetry(ref: RefObject<HTMLDivElement | null>, retry: () => void): () => void {
  const pending = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const element = pending.current
    if (element === null) return
    const active = document.activeElement
    if (active === document.body) element.focus({ preventScroll: true })
    if (!element.contains(active)) pending.current = null
  })
  return useCallback(() => {
    const element = ref.current
    pending.current = element?.contains(document.activeElement) === true ? element : null
    retry()
  }, [ref, retry])
}

/** Read data that counts as nothing found unless `isEmpty` says otherwise. */
function isNothing(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0
}

/**
 * The wait for a first read: a skeleton in the content's geometry, shown only after
 * {@link SKELETON_DELAY_MS} and holding the content's room before it, so nothing jumps.
 */
function SectionSkeleton({ children }: { readonly children: ReactNode }) {
  const shown = useElapsed(SKELETON_DELAY_MS)
  return (
    <div
      aria-hidden="true"
      data-skeleton={shown}
      className={cn("flex flex-col gap-3", !shown && "invisible")}
    >
      {children}
    </div>
  )
}

/**
 * One section's read on a dashboard, the rendering half of whatever reads it: the skeleton while
 * the first read runs (after 400 ms, its room held before), the content once read, `empty` for a
 * read that found nothing, and a failure in the kit's status box with the raw text under Details
 * and Try again unless it is `permanent`. A read that fails after a good one keeps its data on
 * screen with the failure inline above it; a read over data on screen marks the region busy and
 * keeps the data. Under a {@link SectionStateGroup} a failure several sections share is said once.
 * Every word comes from the kit's catalogs or from `state.error`.
 */
export function SectionState<T>({
  state,
  onRetry,
  skeleton,
  empty,
  isEmpty = isNothing,
  errorTitleAs = "p",
  className,
  children,
}: SectionStateProps<T>) {
  const { common } = useUiMessages()
  const ref = useRef<HTMLDivElement>(null)
  const failure = state.error ?? undefined
  const said = useSaidOnce(ref, failure, onRetry)
  const { repeated } = said
  const retry = useFocusKeptOnRetry(ref, said.retry)
  const { data } = state
  const busy = state.loading === true || undefined
  const root = (phase: string, content: ReactNode, waiting = false) => (
    <div
      ref={ref}
      tabIndex={-1}
      data-slot="section-state"
      data-state={phase}
      aria-busy={waiting || busy}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      {content}
    </div>
  )
  if (data === undefined && failure === undefined) {
    return root(
      "loading",
      <>
        <span className="sr-only">{common.loading}</span>
        <SectionSkeleton>{skeleton ?? <Skeleton className="h-24 w-full" />}</SectionSkeleton>
      </>,
      true,
    )
  }
  const notice = failure !== undefined && (
    <FailureNotice
      failure={failure}
      kept={data !== undefined}
      repeated={repeated}
      retry={retry}
      titleAs={errorTitleAs}
    />
  )
  if (data === undefined) return root("error", notice)
  return root(
    failure === undefined ? "ready" : "stale",
    <>
      {notice}
      {contentOf(data, empty, isEmpty, children)}
    </>,
  )
}

/** Read data as the section shows it: the content, or `empty` for a read that found nothing. */
function contentOf<T>(
  data: T | null,
  empty: ReactNode,
  isEmpty: (data: T) => boolean,
  children: (data: T) => ReactNode,
): ReactNode {
  if (data !== null && !isEmpty(data)) return children(data)
  if (empty !== undefined) return empty
  return data === null ? null : children(data)
}

/**
 * A section's failure: the status box (a block in place of the content, inline above content it
 * keeps), or the quiet line of a failure a section before it says.
 */
function FailureNotice({
  failure,
  kept,
  repeated,
  retry,
  titleAs,
}: {
  readonly failure: SectionFailure
  /** The section keeps the data of its last good read below the notice. */
  readonly kept: boolean
  readonly repeated: boolean
  readonly retry: () => void
  readonly titleAs: StateHeadingLevel
}) {
  const { sectionState: words } = useUiMessages()
  if (repeated) {
    return (
      <p className="text-dense text-muted-foreground">
        {kept ? words.sameFailureKept : words.sameFailure}
      </p>
    )
  }
  return (
    <ErrorState
      variant={kept ? "inline" : "block"}
      titleAs={titleAs}
      title={failure.title}
      description={kept ? [failure.hint, words.kept].filter(Boolean).join(" ") : failure.hint}
      details={failure.details}
      onRetry={failure.permanent ? undefined : retry}
    />
  )
}
