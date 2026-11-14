import { useCallback, useState } from "react"
import { cn } from "../lib/utils.js"
import { truncate } from "../format/index.js"

/** The one preview length for log and error text: longer text folds behind a summary. */
export const LOG_TEXT_PREVIEW = 160

/** Unbounded secondary text has no natural cut, so it scrolls; primary lists never do. */
export const TEXT_BLOCK_FRAME = "max-h-80 overflow-auto"

const LOG_TEXT = "text-muted-foreground text-small font-mono"

/**
 * One line in a table row: 10rem at least, so a narrow table scrolls inside its region instead of
 * squeezing the text, else as wide as its column leaves it, cut with an ellipsis.
 */
const LINE_FLOOR = "grid min-w-0 grid-cols-[minmax(10rem,max-content)]"

/**
 * Engine text (an exception, an incident's message) in the kit's one policy: short text whole,
 * longer text as a preview whose disclosure opens on the whole of it. With `line`, for a table
 * row: one line at the row height, cut with an ellipsis where its column ends, the whole text in
 * its title; a line its column cuts, or a long one, is a disclosure that opens on the whole text,
 * so a keyboard and a touch reach it too.
 */
export function LogText({
  text,
  line = false,
  className,
}: {
  text: string | null | undefined
  /** One line in a table row, the whole text in its title and, where it is cut, its disclosure. */
  line?: boolean
  className?: string
}) {
  if (!text) return <span className="text-muted-foreground">—</span>
  // Keyed on its text: a new text is a new line, measured afresh and closed.
  if (line) return <LogLine key={text} text={text} className={className} />
  if (text.length > LOG_TEXT_PREVIEW) return <LogDisclosure text={text} className={className} />
  return <p className={cn(LOG_TEXT, "break-words", className)}>{text}</p>
}

/** The preview as a native disclosure (keyboard and screen-reader ready) over the whole text. */
function LogDisclosure({
  text,
  title,
  className,
  onToggle,
}: {
  text: string
  title?: string
  className?: string
  onToggle?: (open: boolean) => void
}) {
  return (
    <details className={className} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary title={title} className={cn(LOG_TEXT, "w-full cursor-pointer truncate rounded-sm")}>
        {truncate(text, LOG_TEXT_PREVIEW)}
      </summary>
      <pre
        className={cn(
          "bg-muted border-border text-small mt-1 rounded-sm border p-2 font-mono whitespace-pre-wrap",
          TEXT_BLOCK_FRAME,
        )}
      >
        {text}
      </pre>
    </details>
  )
}

/**
 * Whether the line its floor shows is cut: measured once drawn, again whenever the floor changes
 * size (its column's width) and once the fonts have loaded.
 */
function useCutLine() {
  const [cut, setCut] = useState(false)
  // A callback ref: it measures the floor once attached and stops on detach.
  const attach = useCallback((floor: HTMLDivElement | null) => {
    if (!floor) return
    const measure = () => {
      const shown = floor.querySelector("p, summary")
      setCut(shown !== null && shown.scrollWidth > shown.clientWidth)
    }
    measure()
    if ("fonts" in document) void document.fonts.ready.then(measure)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(floor)
    return () => observer.disconnect()
  }, [])
  return [cut, attach] as const
}

/**
 * The one line of a table row. A line its column cuts turns into a disclosure, and one that is
 * open stays one while it is open, though its whole text may widen the column until it fits.
 */
function LogLine({ text, className }: { text: string; className?: string }) {
  const [cut, attach] = useCutLine()
  const [open, setOpen] = useState(false)
  const disclosed = cut || open || text.length > LOG_TEXT_PREVIEW
  return (
    <div ref={attach} className={cn(LINE_FLOOR, className)}>
      {disclosed ? (
        <LogDisclosure text={text} title={text} className="min-w-0" onToggle={setOpen} />
      ) : (
        <p title={text} className={cn(LOG_TEXT, "min-w-0 truncate")}>
          {text}
        </p>
      )}
    </div>
  )
}
