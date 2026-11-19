import { useEffect, useEffectEvent } from "react"
import { useHost } from "./host-context.js"

export function useLiveHold(): void {
  const host = useHost()
  const hold = useEffectEvent((held: boolean) => {
    host.post({ type: "holdLiveUpdates", held })
  })
  useEffect(() => {
    hold(true)
    return () => {
      hold(false)
    }
  }, [])
}
