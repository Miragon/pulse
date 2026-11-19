import { useRef, useState } from "react"
import {
  cn,
  FOCUS_RING,
  FOCUS_RING_INSET,
  Icon,
  TEXT_BLOCK_FRAME,
  useLocale,
} from "@miragon/pulse-ui"
import { Check, Copy } from "lucide-react"
import { useCopyId } from "./id-text.js"
import { kitLabels } from "./kit-labels.js"

/**
 * Under 40rem of the block's own width its lines wrap and the frame's height cap goes: the page
 * scrolls, never a box inside the scrolling page of a phone.
 */
const NARROW = [
  "@max-[40rem]/text-block:max-h-none",
  "@max-[40rem]/text-block:whitespace-pre-wrap",
  "@max-[40rem]/text-block:wrap-anywhere",
].join(" ")

/** Selects the block's text, so a reader whose copy failed copies it by hand. */
function selectText(element: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

export interface TextBlockProps {
  /** The text, whole, as the engine wrote it (a job's stacktrace, a worker's error details). */
  text: string
  /** What the text is ("Stacktrace"): the block's name, and its toasts' ("Stacktrace copied"). */
  label: string
  /** The copy button's name and title ("Copy stacktrace"). */
  copyLabel: string
  className?: string
}

/**
 * A block of engine text that a reader copies whole: a job's stacktrace, a worker's error details.
 * Its lines in mono on the card's surface, in the kit's text block frame, scrolling inside it, a
 * named region that takes focus (a tab stop with the kit's focus ring), so a keyboard scrolls it
 * in every browser, Safari's too. Its copy button sits at its top end in `IdText`'s pattern: the
 * 24 px control with a 12 px icon, a toast that names what was copied, a check for two seconds.
 * Copying is no write: it shows on every host, a page outside a chat too. A failed copy says so
 * and selects the text, to copy by hand. Under 40rem of its width its lines wrap and the frame's
 * height cap goes, so the page scrolls rather than a box inside it.
 */
export function TextBlock({ text, label, copyLabel, className }: TextBlockProps) {
  const labels = kitLabels(useLocale())
  const copyText = useCopyId({
    copied: labels.copiedOf(label),
    failed: labels.copyFailedOf(label),
    failedHint: labels.textCopyFailedHint,
  })
  const blockRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return
    }
    const block = blockRef.current
    if (!block) return
    block.focus()
    selectText(block)
  }
  return (
    <div data-slot="text-block" className={cn("@container/text-block relative", className)}>
      <pre
        ref={blockRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "border-border bg-card text-foreground text-small p-gutter rounded-md border pe-10 font-mono leading-relaxed",
          TEXT_BLOCK_FRAME,
          NARROW,
          FOCUS_RING,
        )}
      >
        {text}
      </pre>
      <button
        type="button"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void copy()}
        className={cn(
          "bg-card text-muted-foreground hover:text-foreground size-control-xs absolute top-3 right-3 inline-flex items-center justify-center rounded-sm",
          FOCUS_RING_INSET,
        )}
      >
        <Icon icon={copied ? Check : Copy} dense />
      </button>
    </div>
  )
}
