import { useEffect, useState } from "react"

/**
 * Returns `value` delayed by `delayMs`, resetting the timer on every change.
 * Use to debounce a search box so a server-side filter only re-queries once the
 * user pauses typing (not on every keystroke). Pure React — no host dependency.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
