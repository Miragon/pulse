// Replaced by @miragon/pulse-ui's SectionState once Miragon/pulse#664 lands.
import { useEffect, useState, type ReactNode } from "react"
import { ErrorState, useLocale } from "@miragon/pulse-ui"
import type { Section } from "../engine/use-engine.tsx"
import { describeEngineError } from "../engine/errors.ts"
import { useT } from "../messages.ts"

/** A skeleton shows only after this long, so a fast read never flashes one (the kit's 400 ms). */
export const SKELETON_DELAY_MS = 400

/** True once `active` has held for `delayMs`. */
function useDelayed(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) {
      setShown(false)
      return undefined
    }
    const timer = setTimeout(() => {
      setShown(true)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [active, delayMs])
  return shown && active
}

export interface SectionStateProps<T> {
  section: Section<T>
  /** The section's skeleton, in the loaded content's geometry. */
  skeleton: ReactNode
  /** The loaded content. */
  children: (data: T) => ReactNode
}

/**
 * A section's state, the rendering half of `useSection`: the skeleton after 400 ms while the first
 * read runs (before it, its room stays empty, so nothing jumps), the failure in the kit's words
 * when there is nothing to show (Try again only where a retry can help, the raw text under
 * Details), the content once read, and a failed refresh as an inline notice above the content it
 * keeps. While a refresh runs the content stays, its region marked busy. A failure a section
 * earlier on the page says already is said once: here only a quiet line that the section was not
 * read, and the first one's Try again reads every section that failed alike.
 */
export function SectionState<T>({ section, skeleton, children }: SectionStateProps<T>) {
  const locale = useLocale()
  const t = useT()
  const waiting = section.data === undefined && section.status === "loading"
  const showSkeleton = useDelayed(waiting, SKELETON_DELAY_MS)
  if (waiting) {
    return (
      <div aria-busy="true" className={showSkeleton ? undefined : "invisible"}>
        {skeleton}
      </div>
    )
  }
  const words = section.error === undefined ? undefined : describeEngineError(section.error, locale)
  const failure =
    words === undefined ? null : section.repeatsFailure ? (
      <p className="text-muted-foreground m-0">
        {t(section.data === undefined ? "section.sameFailure" : "section.sameFailureKept")}
      </p>
    ) : (
      <ErrorState
        variant={section.data === undefined ? "block" : "inline"}
        titleAs="p"
        title={words.title}
        description={words.hint}
        details={words.details ?? undefined}
        onRetry={words.retry ? section.retry : undefined}
      />
    )
  if (section.data === undefined) return failure
  return (
    <div aria-busy={section.refreshing || undefined} className="flex flex-col gap-3">
      {failure}
      {children(section.data)}
    </div>
  )
}
