import { useEffect, useRef, useState } from "react"
import {
  cn,
  FIELD_TEXT,
  FOCUS_RING,
  FOCUS_RING_INSET,
  useLocale,
  useToast,
  Icon,
  Td,
  shortId,
} from "@miragon/pulse-ui"
import { Check, Copy } from "lucide-react"
import { kitLabels } from "./kit-labels.js"

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
        "border-input bg-background text-foreground min-w-0 rounded-sm border px-1 font-mono",
        // A field's text: 16 px on a coarse pointer, so iOS never zooms in when it takes focus.
        FIELD_TEXT,
        FOCUS_RING,
      )}
    />
  )
}

/**
 * In a table row the copy button shows while the pointer is over the row or focus is in it, so
 * a row stays one quiet line: transparent, never `visibility: hidden`, so it keeps its place in
 * the tab order and shows when it takes focus. On a screen without hover it always shows, and
 * outside a table (a header, facts) too. In a row it reaches into the cell's padding above and
 * below (`--cell-py`), so the 24 px target (32 px on touch) keeps the row at its height.
 */
const COPY_IN_ROW =
  "[@media(hover:hover)]:[tr_&]:opacity-0 [tr:hover_&]:opacity-100 [tr:focus-within_&]:opacity-100 focus-visible:opacity-100 [tr_&]:-my-(--cell-py)"

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
          "text-muted-foreground hover:text-foreground size-control-xs inline-flex shrink-0 items-center justify-center rounded-sm transition-opacity motion-reduce:transition-none",
          // Drawn inside the button: a cell at the region's edge would cut an outset ring.
          FOCUS_RING_INSET,
          COPY_IN_ROW,
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
