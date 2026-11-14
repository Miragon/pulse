import { CheckIcon, CopyIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Button, FOCUS_RING_INSET, Icon, cn } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"

const CONFIRMATION_MS = 1500

export interface CopyButtonProps {
  readonly text: string
  readonly label: string
  readonly className?: string
}

export function useCopied(): readonly [boolean, () => void] {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, CONFIRMATION_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])

  return [
    copied,
    () => {
      setCopied(true)
    },
  ]
}

export function CopyButton({ text, label, className }: CopyButtonProps) {
  const host = useHost()
  const [copied, markCopied] = useCopied()

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-offset-0",
          FOCUS_RING_INSET,
          className,
        )}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          host.post({ type: "copy", text, label })
          markCopied()
        }}
      >
        <Icon icon={copied ? CheckIcon : CopyIcon} />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </>
  )
}
