import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import {
  Button,
  FOCUS_RING_INSET,
  Icon,
  TEXT_BLOCK_FRAME,
  cn,
  useUiMessages,
} from "@miragon/pulse-ui"
import type { VariableRowData } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { JsonText } from "./json-text.js"

/** A value longer than this opens on a line of its own, as an object or a list does. */
const INLINE_LENGTH = 48

/** How long the copy button shows its check after a copy. */
const COPIED_MS = 1500

/**
 * The copy button shows on the row's hover and focus, on its own focus and always on touch. At
 * rest it is transparent, never hidden, so it stays in the tab order and keeps its name for a
 * screen reader, also in a row with no other control (a value no surface edits).
 */
const COPY_REVEAL =
  "opacity-0 focus-visible:opacity-100 in-[tr:hover]:opacity-100 in-[tr:focus-within]:opacity-100 any-pointer-coarse:opacity-100"

/** In a table whose columns the user sized, the value takes its column's width. */
const SIZED_COLUMN = "group-data-[state=fixed]/data-table:max-w-none"

function isExpandable(row: VariableRowData): boolean {
  const value = row.valueJson.trim()
  return value.length > INLINE_LENGTH || value.startsWith("{") || value.startsWith("[")
}

function ValueText({ row, open }: { readonly row: VariableRowData; readonly open: boolean }) {
  const t = useInstanceWords()
  if (open) {
    return (
      <pre
        className={cn(
          "border-border bg-background text-dense my-0.5 max-w-[min(96ch,64vw)] rounded-sm border px-3 py-2 font-mono wrap-anywhere whitespace-pre-wrap",
          SIZED_COLUMN,
          TEXT_BLOCK_FRAME,
        )}
      >
        {row.truncated ? row.valueJson : JsonText.pretty(row.valueJson)}
      </pre>
    )
  }
  const cutOff = row.truncated ? ` (${t("variable.cutOff")})` : ""
  return (
    <code
      className={cn("max-w-[min(64ch,56vw)] truncate font-mono", SIZED_COLUMN)}
      title={`${row.valueJson}${cutOff}`}
    >
      {row.valueJson}
    </code>
  )
}

function CopyValue({
  row,
  onCopy,
}: {
  readonly row: VariableRowData
  readonly onCopy: InstanceSlots["onCopy"]
}) {
  const t = useInstanceWords()
  const { copyableId } = useUiMessages()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, COPIED_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])
  const label = t(row.truncated ? "variable.copyCutOff" : "variable.copy", { name: row.name })
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-offset-0",
          FOCUS_RING_INSET,
          COPY_REVEAL,
        )}
        aria-label={copied ? copyableId.copied({ label }) : copyableId.copy({ label })}
        title={copied ? copyableId.done : copyableId.copy({ label })}
        onClick={(event) => {
          event.stopPropagation()
          onCopy({ text: row.valueJson, label })
          setCopied(true)
        }}
      >
        <Icon icon={copied ? CheckIcon : CopyIcon} />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? copyableId.done : ""}
      </span>
    </>
  )
}

/**
 * A variable's value in its cell: one line in mono, cut with an ellipsis, the whole in its title;
 * a long value, an object or a list opens on lines of its own; a value the engine cut off says so;
 * a copy button and the surface's controls (an editor's button) at its end.
 */
export function VariableValue({
  row,
  controls,
  onCopy,
}: {
  readonly row: VariableRowData
  readonly controls: ReactNode
  readonly onCopy: InstanceSlots["onCopy"]
}) {
  const t = useInstanceWords()
  const [open, setOpen] = useState(false)
  return (
    <div
      className={cn(
        "min-h-row -ml-1 flex min-w-0 items-center gap-1",
        open && "items-start py-0.5",
      )}
    >
      {isExpandable(row) && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-label={t(open ? "variable.collapse" : "variable.expand", { name: row.name })}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />
        </Button>
      )}
      <ValueText row={row} open={open} />
      {row.truncated && (
        <span className="text-muted-foreground whitespace-nowrap">{t("variable.cutOff")}</span>
      )}
      <CopyValue row={row} onCopy={onCopy} />
      {controls}
    </div>
  )
}
