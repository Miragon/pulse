import { useEffect, useState } from "preact/hooks"
import type { WebviewIntent, WriteState } from "../../core/protocol/index.js"
import { useHost } from "./host-context.js"

type Phase = "editing" | "sent" | "seen"

export function useSubmission(mine: WriteState | undefined, onClose: () => void) {
  const host = useHost()
  const [phase, setPhase] = useState<Phase>("editing")
  const [sentWith, setSentWith] = useState("")
  useEffect(() => {
    const answered = phase === "seen" || (phase === "sent" && JSON.stringify(mine) !== sentWith)
    if (!answered) {
      return
    }
    if (mine?.status === "done") {
      onClose()
    } else if (mine?.status === "cancelled") {
      setPhase("editing")
    } else if (phase === "sent") {
      setPhase("seen")
    }
  }, [phase, mine, sentWith, onClose])
  return {
    phase,
    submit: (intent: WebviewIntent) => {
      setSentWith(JSON.stringify(mine))
      setPhase("sent")
      host.post(intent)
    },
  }
}
