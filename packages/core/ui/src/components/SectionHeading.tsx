import type { ReactNode } from "react"
import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

export interface SectionHeadingProps {
  /** The section title. */
  title: ReactNode
  /** Optional muted hint shown on the right (e.g. a count or last-updated note). */
  hint?: ReactNode
  /** Right-aligned slot that overrides `hint` when set (e.g. a control). */
  trailing?: ReactNode
}

/**
 * Section title row: a small semibold heading with an optional muted hint or
 * control on the right. Use to label a block inside a widget body (e.g. a list
 * or sub-table) without the visual weight of a full card header. The title is
 * a caption ({@link MICRO_LABEL}: 13 px semibold, normal case). A section that
 * needs a real heading keeps that step at its level: a collapsible `Section`
 * with `as`, or an `h2`/`h3` with `MICRO_LABEL`; `text-section` (21 px) is
 * only for a dialog's title and a KPI figure.
 */
export function SectionHeading({ title, hint, trailing }: SectionHeadingProps) {
  return (
    <div
      className={cn("text-muted-foreground mb-3 flex items-center justify-between", MICRO_LABEL)}
    >
      <span>{title}</span>
      {(hint || trailing) && (
        <span className="text-muted-foreground text-small">{trailing ?? hint}</span>
      )}
    </div>
  )
}
