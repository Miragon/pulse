import { useEffect, useState } from "preact/hooks"
import { glyphs } from "./lucide-glyphs.json"
import { useHost } from "../host/host-context.js"
import { Icon } from "./icon.js"

const CONFIRMATION_MS = 1500

export interface CopyButtonProps {
  readonly text: string
  readonly label: string
  readonly class?: string
}

export function CopyButton({ text, label, class: className }: CopyButtonProps) {
  const host = useHost()
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

  return (
    <>
      <button
        type="button"
        class={`icon-button icon-button--small ${className ?? ""}`}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          host.post({ type: "copy", text, label })
          setCopied(true)
        }}
      >
        <Icon of={copied ? glyphs.Check : glyphs.Copy} />
      </button>
      <span class="visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </>
  )
}
