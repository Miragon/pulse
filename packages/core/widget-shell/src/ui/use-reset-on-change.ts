import { useState } from "react"

/**
 * Runs `reset` in the RENDER phase when `key`'s identity changes: an effect
 * would commit the stale state first (a visible flash). Keying on the data
 * object covers a refetch with equal values. `reset` may only touch the
 * calling component's state.
 */
export function useResetOnChange(key: unknown, reset: () => void): void {
  const [prev, setPrev] = useState(key)
  if (!Object.is(key, prev)) {
    setPrev(key)
    reset()
  }
}
