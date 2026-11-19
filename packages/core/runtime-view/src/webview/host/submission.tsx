import { useEffect, useEffectEvent, useState } from "react"
import type { WebviewIntent, WriteState } from "../../core/protocol/index.js"
import { useHost } from "./host-context.js"

type Phase = "editing" | "sent" | "seen"

export function useSubmission(mine: WriteState | undefined, onClose: () => void) {
  const host = useHost()
  const [phase, setPhase] = useState<Phase>("editing")
  const [sentWith, setSentWith] = useState("")
  const answered = phase === "seen" || (phase === "sent" && JSON.stringify(mine) !== sentWith)
  const status = answered ? mine?.status : undefined
  if (status === "cancelled") {
    setPhase("editing")
  } else if (phase === "sent" && answered && status !== "done") {
    setPhase("seen")
  }
  const close = useEffectEvent(onClose)
  const done = status === "done"
  useEffect(() => {
    if (done) {
      close()
    }
  }, [done])
  return {
    phase,
    submit: (intent: WebviewIntent) => {
      setSentWith(JSON.stringify(mine))
      setPhase("sent")
      host.post(intent)
    },
  }
}
