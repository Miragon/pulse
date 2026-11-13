import type { ReactNode } from "react"
import { BAR_CONTAINER, BAR_INSET } from "../lib/bar.js"
import { cn } from "../lib/utils.js"

export interface ToolbarProps {
  /** The controls, left to right: a `SegmentedControl`, a `SearchField`, chips, toolbar buttons. */
  children: ReactNode
  /** A line on what the list shows ("Showing 20 of 160"), at the end in quiet tabular figures. */
  summary?: ReactNode
  /** Beside the summary: a legend's button, say. */
  aside?: ReactNode
  /** Names the bar as a group of controls. */
  ariaLabel?: string
  className?: string
}

/**
 * The bar of controls above a list (the webview's filter bar): 36 px high with its rule below
 * included, the gutter at its sides, its controls 8 px apart, the summary and the aside at the
 * end. Its container is `bar`: a `SearchField` inside shrinks under 1180 px, a toolbar button's
 * label collapses under 36rem, and under 760 px the bar takes two lines, the summary and the
 * aside first, the controls below them with the whole width to wrap in. It runs from edge to edge
 * of its surface: right under a view's bar it goes into the shell's header, inside padded content
 * it takes `-mx-gutter` (a view's tab bar does the same).
 */
export function Toolbar({ children, summary, aside, ariaLabel, className }: ToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        BAR_CONTAINER,
        "border-border min-h-toolbar flex min-w-0 flex-col justify-center border-b",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 @max-[47.5rem]/bar:flex-wrap @max-[47.5rem]/bar:gap-y-1 @max-[47.5rem]/bar:py-1",
          BAR_INSET,
        )}
      >
        {children}
        {(summary !== undefined || aside !== undefined) && (
          <div
            data-slot="toolbar-end"
            className="ml-auto flex min-w-0 items-center justify-end gap-2 @max-[47.5rem]/bar:order-first @max-[47.5rem]/bar:basis-full"
          >
            {summary !== undefined && (
              <span
                data-slot="toolbar-summary"
                className="text-small text-muted-foreground min-w-0 truncate tabular-nums"
              >
                {summary}
              </span>
            )}
            {aside}
          </div>
        )}
      </div>
    </div>
  )
}
