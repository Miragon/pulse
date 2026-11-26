import { useCallback, useState } from "react"
import { cn } from "../lib/utils.js"
import { truncate } from "../format/index.js"

/** The one preview length for log and error text: longer text folds behind a summary. */
export const LOG_TEXT_PREVIEW = 160

/** Unbounded secondary text has no natural cut, so it scrolls; primary lists never do. */
export const TEXT_BLOCK_FRAME = "max-h-80 overflow-auto"

/**
 * What engine text is, which sets its look. `message`: words a person reads (an incident's or an
 * exception's message, a cluster's representative message), in the sans and the foreground, as
 * the webview's incident facts show it. `code`: what a machine wrote (a stacktrace's lines, a raw
 * value), in mono and quiet.
 */
export type LogTextKind = "message" | "code"

/**
 * Each kind's look as a block, and as a table row's line, where a message stays quiet so 50 rows
 * of one failure never outweigh the column that names it.
 */
const KIND_TEXT: Readonly<Record<LogTextKind, { block: string; line: string }>> = {
  message: { block: "text-foreground", line: "text-muted-foreground" },
  code: { block: "text-muted-foreground font-mono", line: "text-muted-foreground font-mono" },
}

/** The whole text under a disclosure: a message wraps as words, code keeps its lines in mono. */
const KIND_WHOLE: Readonly<Record<LogTextKind, string>> = {
  message: "text-foreground",
  code: "text-foreground font-mono",
}

/** The type step of a block: a caption by default, the body step for a detail page's own message. */
export type LogTextSize = "small" | "body"

const SIZE_TEXT: Readonly<Record<LogTextSize, string>> = {
  small: "text-small",
  body: "text-body",
}

/**
 * One line in a table row: 10rem at least, so a narrow table scrolls inside its region instead of
 * squeezing the text, else as wide as its column leaves it, cut with an ellipsis.
 */
const LINE_FLOOR = "grid min-w-0 grid-cols-[minmax(10rem,max-content)]"

/**
 * Engine text (an exception, an incident's message) in the kit's one policy: short text whole,
 * longer text as a preview whose disclosure opens on the whole of it. Its `kind` sets its look: a
 * `message` is words (the sans, the foreground), `code` what a machine wrote (mono, quiet). With
 * `line`, for a table row: one line at the row height, cut with an ellipsis where its column
 * ends, the whole text in its title; a line its column cuts, or a long one, is a disclosure that
 * opens on the whole text, so a keyboard and a touch reach it too.
 */
export function LogText({
  text,
  kind,
  size = "small",
  line = false,
  className,
}: {
  text: string | null | undefined
  /** What the text is: a person's words (`message`) or a machine's (`code`). */
  kind: LogTextKind
  /**
   * The step of a block, `small` by default; `body` for the message a detail page is about, which
   * leads its page. A table row's line keeps the caption step.
   */
  size?: LogTextSize
  /** One line in a table row, the whole text in its title and, where it is cut, its disclosure. */
  line?: boolean
  className?: string
}) {
  if (!text) return <span className="text-muted-foreground">—</span>
  // Keyed on its text: a new text is a new line, measured afresh and closed.
  if (line) return <LogLine key={text} text={text} kind={kind} className={className} />
  const look = cn(KIND_TEXT[kind].block, SIZE_TEXT[size])
  if (text.length > LOG_TEXT_PREVIEW) {
    return <LogDisclosure text={text} kind={kind} look={look} className={className} />
  }
  return <p className={cn(look, "break-words", className)}>{text}</p>
}

/**
 * The preview as a native disclosure (keyboard and screen-reader ready) over the whole text, which
 * wraps at its lines and breaks a long unbroken token (a URL, an encoded payload) anywhere, so it
 * never scrolls sideways. In a table row (`line`) the whole text takes the width its line has and
 * never widens the column: its own width counts for nothing in the table's layout.
 */
function LogDisclosure({
  text,
  kind,
  look,
  title,
  line = false,
  className,
  onToggle,
}: {
  text: string
  kind: LogTextKind
  /** The summary's look: the kind's and the step's. */
  look: string
  title?: string
  line?: boolean
  className?: string
  onToggle?: (open: boolean) => void
}) {
  return (
    <details className={className} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary title={title} className={cn(look, "w-full cursor-pointer truncate rounded-sm")}>
        {truncate(text, LOG_TEXT_PREVIEW)}
      </summary>
      <pre
        className={cn(
          "bg-muted border-border text-small mt-1 rounded-sm border p-2 wrap-anywhere whitespace-pre-wrap",
          KIND_WHOLE[kind],
          line && "[contain:inline-size]",
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
 * open stays one while it is open; its whole text wraps in the column's width, never widening it.
 */
function LogLine({
  text,
  kind,
  className,
}: {
  text: string
  kind: LogTextKind
  className?: string
}) {
  const [cut, attach] = useCutLine()
  const [open, setOpen] = useState(false)
  const disclosed = cut || open || text.length > LOG_TEXT_PREVIEW
  const look = cn(KIND_TEXT[kind].line, "text-small")
  return (
    <div ref={attach} className={cn(LINE_FLOOR, className)}>
      {disclosed ? (
        <LogDisclosure
          text={text}
          kind={kind}
          look={look}
          title={text}
          line
          className="min-w-0"
          onToggle={setOpen}
        />
      ) : (
        <p title={text} className={cn(look, "min-w-0 truncate")}>
          {text}
        </p>
      )}
    </div>
  )
}
