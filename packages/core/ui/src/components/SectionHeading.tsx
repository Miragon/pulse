import type { ReactNode } from "react"
import type { SectionHeadingLevel } from "../kit/section.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

export interface SectionHeadingProps {
  /** The section title. */
  title: ReactNode
  /** Optional muted hint shown on the right (e.g. a count or last-updated note). */
  hint?: ReactNode
  /** Right-aligned slot that overrides `hint` when set (e.g. a control). */
  trailing?: ReactNode
  /**
   * The title's heading element, so the section sits in the view's outline at its level (`h2`
   * for a block of the view, `h3` under it). Default: none, a caption outside the outline.
   */
  as?: SectionHeadingLevel
  /** The title's id, for the section's `aria-labelledby`. */
  id?: string
  /** Classes for the row, a margin other than the default 12 px below it (`mb-2`, `mb-0`). */
  className?: string
}

/**
 * Section title row: a small semibold heading with an optional muted hint or control on the
 * right. Use to label a block inside a widget body (e.g. a list or sub-table) without the visual
 * weight of a full card header. The title is the compact section title of every Pulse UI, the
 * webview's: 13 px at 600 in the foreground ({@link MICRO_LABEL}, normal case); the hint stays
 * quiet. Pass `as` where the section needs a real heading, so every section title of a view has
 * one look whatever its level; `text-section` (21 px) is only for a dialog's title and a KPI
 * figure. Where the row is short of room the hint moves under the title, never cut.
 */
export function SectionHeading({ title, hint, trailing, as, id, className }: SectionHeadingProps) {
  const Title = as ?? "span"
  return (
    <div
      data-slot="section-heading"
      className={cn(
        "text-foreground mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1",
        MICRO_LABEL,
        className,
      )}
    >
      <Title id={id} className={MICRO_LABEL}>
        {title}
      </Title>
      {(hint || trailing) && (
        <span className="text-muted-foreground text-small font-normal">{trailing ?? hint}</span>
      )}
    </div>
  )
}
