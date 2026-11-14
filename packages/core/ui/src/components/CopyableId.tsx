import { useEffect, useState, type MouseEvent } from "react"
import { Check, Copy } from "lucide-react"
import { shortId } from "../format/index.js"
import { Icon } from "../kit/icon.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"

/** How long the copy button shows its check after a copy. */
export const COPIED_MS = 1500

export interface CopyableIdProps {
  /** The whole id: what is copied, and the text's title. */
  id: string
  /** What the id is, for the copy button's name ("instance ID"). */
  label: string
  /**
   * Copies the whole id the host's way (the clipboard, a host intent). Resolving to `false` says
   * the copy failed, and so does a throw or a rejection (a clipboard the browser refuses): the
   * button then shows no check.
   */
  onCopy: (id: string) => void | boolean | Promise<void | boolean>
  /** `short` (default): the id by `shortId`, the whole one read out; `full`: the whole id. */
  display?: "short" | "full"
  className?: string
}

/**
 * The copy button's reveal: where a pointer can hover it shows on the id's hover and focus (and
 * a table row's), and on its own focus, staying in the tab order (transparent, never hidden). It
 * always shows on a screen without hover, in a `ViewBar` and in `Facts`. In a row it reaches into
 * the cell's padding, so the row keeps its height.
 */
const REVEAL =
  "[@media(hover:hover)]:opacity-0 group-hover/copyable:opacity-100 group-focus-within/copyable:opacity-100 [tr:hover_&]:opacity-100 [tr:focus-within_&]:opacity-100 focus-visible:opacity-100 [[data-slot=facts]_&]:opacity-100 [[data-slot=view-bar]_&]:opacity-100 [tr_&]:-my-(--cell-py) transition-opacity motion-reduce:transition-none"

/** The check after a copy, for {@link COPIED_MS}. */
function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return [copied, () => setCopied(true)]
}

/**
 * An id in monospace with a copy button (the webview's id text): props and callbacks only, the
 * copy itself is the host's (`onCopy`). The id shows short (`shortId`) with the whole id in its
 * title and read out; the button is the 24 px control, named by what the id is, and confirms a
 * copy with a check for 1.5 s and a polite live region. A click on it stays its own: a table row
 * around it does not open.
 */
export function CopyableId({ id, label, onCopy, display = "short", className }: CopyableIdProps) {
  const { copyableId } = useUiMessages()
  const [copied, markCopied] = useCopied()
  const short = display === "short" ? shortId(id) : id
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    let succeeded: boolean
    try {
      succeeded = (await onCopy(id)) !== false
    } catch {
      // A refused clipboard is a failed copy, never an unhandled rejection: no check.
      succeeded = false
    }
    if (succeeded) markCopied()
  }
  const name = copied ? copyableId.copied({ label }) : copyableId.copy({ label })
  return (
    <span
      data-slot="copyable-id"
      className={cn(
        "group/copyable inline-flex max-w-full min-w-0 items-center gap-0.5",
        className,
      )}
    >
      <code title={id} className="text-dense min-w-0 truncate font-mono tabular-nums">
        {short === id ? (
          id
        ) : (
          <>
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{id}</span>
          </>
        )}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={name}
        title={name}
        onClick={(event) => void copy(event)}
        // Drawn inside the button: a cell at the region's edge would cut an outset ring.
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-offset-0",
          FOCUS_RING_INSET,
          REVEAL,
        )}
      >
        <Icon icon={copied ? Check : Copy} />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? copyableId.done : ""}
      </span>
    </span>
  )
}
