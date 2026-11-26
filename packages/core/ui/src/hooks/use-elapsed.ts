import { useEffect, useState } from "react"

/**
 * How long a first load runs before its skeleton shows (the webview's rule): a quick answer
 * replaces nothing with its content, without a skeleton flashing up for a moment. Every Pulse UI
 * waits this long: `SectionState`, widget-shell's `ViewDataState` and `QueryFallback`.
 */
export const SKELETON_DELAY_MS = 400

/**
 * True once `delayMs` passed since the component mounted: mount it with the wait it measures (a
 * skeleton's component), so the next wait starts at false again.
 */
export function useElapsed(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])
  return elapsed
}
