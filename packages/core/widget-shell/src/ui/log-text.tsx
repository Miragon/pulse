import { cn } from "@miragon/mcp-toolkit-ui"
import { truncate } from "./format.js"

/** THE single truncation policy for engine error text; widgets used to cut at 50/60/160 each. */
export const LOG_TEXT_PREVIEW = 160

/** Unbounded secondary text has no natural cut, so it scrolls; primary lists never do (#396). */
export const TEXT_BLOCK_FRAME = "max-h-80 overflow-auto"

export function LogText({
  text,
  className,
}: {
  text: string | null | undefined
  className?: string
}) {
  if (!text) return <span className="text-muted-foreground">—</span>
  if (text.length <= LOG_TEXT_PREVIEW) {
    return (
      <p className={cn("text-muted-foreground text-small font-mono break-words", className)}>
        {text}
      </p>
    )
  }
  return (
    <details className={className}>
      <summary className="text-muted-foreground text-small w-full cursor-pointer truncate rounded-sm font-mono">
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
