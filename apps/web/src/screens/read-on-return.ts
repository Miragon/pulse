import { useEffect, useEffectEvent } from "react"
import { isPermanentError } from "@miragon/pulse-widget-shell/widgets"

/** How old a screen's last read is before the reader's return reads it again (D10's point 8). */
export const READ_AGAIN_AFTER_MS = 60_000

/** What the reader's return needs of a screen's read: TanStack's query result. */
interface ScreenRead {
  readonly dataUpdatedAt: number
  readonly errorUpdatedAt: number
  readonly error: Error | null
  readonly refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>
}

/**
 * Reads a screen again when the reader comes back to the page, its window focused again or its
 * tab shown again, and its last read is older than 60 s; nothing polls. TanStack's own refetch on
 * focus follows the tab's visibility alone, so a move between two windows would read nothing: the
 * screen listens to both. The two events of one return read once (a read that runs is joined,
 * never started again), and a refusal no retry changes (`isPermanentError`) is not read again.
 * Only while `enabled`: a screen that does not read yet reads nothing on a return either.
 */
export function useReadOnReturn(read: ScreenRead, enabled: boolean): void {
  const onReturn = useEffectEvent(() => {
    const last = Math.max(read.dataUpdatedAt, read.errorUpdatedAt)
    if (Date.now() - last < READ_AGAIN_AFTER_MS) return
    if (read.error !== null && isPermanentError(read.error)) return
    void read.refetch({ cancelRefetch: false })
  })
  useEffect(() => {
    if (!enabled) return undefined
    const onFocus = () => {
      onReturn()
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [enabled])
}
