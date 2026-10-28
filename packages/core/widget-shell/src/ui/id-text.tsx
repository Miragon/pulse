import { useEffect, useRef, useState } from "react"
import { cn, FOCUS_RING, useLocale, useToast } from "@miragon/mcp-toolkit-ui"
import { Check, Copy } from "lucide-react"
import { Icon } from "./icon.js"
import { kitLabels } from "./kit-labels.js"
import { Td } from "./table.js"

export const ID_FULL_LENGTH = 12
const ID_SHORT_LENGTH = 8

export function shortId(value: string): string {
  return value.length <= ID_FULL_LENGTH ? value : `${value.slice(0, ID_SHORT_LENGTH)}…`
}

/** The path a sandboxed frame without the Clipboard API still has. */
function selectionCopy(text: string): boolean {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  let copied: boolean
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

/** Resolves to whether it worked, so a view never fails silently. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied in this frame: fall through to the selection copy.
  }
  return selectionCopy(text)
}

/** After a failed copy, so "copy it yourself" works for a shortened id too. */
function RevealedId({
  value,
  label,
  onDone,
}: {
  value: string
  label: string
  onDone: (refocus: boolean) => void
}) {
  const fieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    fieldRef.current?.focus()
    fieldRef.current?.select()
  }, [])
  return (
    <input
      ref={fieldRef}
      readOnly
      value={value}
      aria-label={label}
      size={value.length}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => onDone(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(true)
      }}
      className={cn(
        "text-dense border-input bg-background text-foreground min-w-0 rounded-sm border px-1 font-mono",
        FOCUS_RING,
      )}
    />
  )
}

export function IdText({ value, className }: { value: string; className?: string }) {
  const labels = kitLabels(useLocale())
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const short = shortId(value)
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.show({ tone: "success", title: labels.idCopied })
    } else {
      setRevealed(true)
      toast.show({ tone: "danger", title: labels.copyFailed, description: labels.copyFailedHint })
    }
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      {revealed ? (
        <RevealedId
          value={value}
          label={labels.fullId}
          onDone={(refocus) => {
            setRevealed(false)
            if (refocus) buttonRef.current?.focus()
          }}
        />
      ) : (
        <span className="text-dense truncate font-mono" title={value}>
          {short === value ? (
            value
          ) : (
            <>
              <span aria-hidden="true">{short}</span>
              <span className="sr-only">{value}</span>
            </>
          )}
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        aria-label={labels.copyId(short)}
        title={labels.copyId(short)}
        onClick={() => void copy()}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-sm",
          FOCUS_RING,
        )}
      >
        <Icon icon={copied ? Check : Copy} dense />
      </button>
    </span>
  )
}

export function IdCell({
  value,
  align,
  className,
}: {
  value: string
  align?: "left" | "right"
  className?: string
}) {
  return (
    <Td align={align} className={cn("whitespace-nowrap", className)}>
      <IdText value={value} />
    </Td>
  )
}
