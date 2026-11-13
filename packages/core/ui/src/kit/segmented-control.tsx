import type { ReactNode } from "react"
import { CircleX, TriangleAlert } from "lucide-react"
import { formatCompactCount, formatCount, type Count } from "../format/index.js"
import { cn } from "../lib/utils.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { Icon } from "./icon.js"

/** An alarming count's tone: its icon has a shape of its own, so colour is never the only signal. */
export type SegmentedCountTone = "danger" | "warning"

export interface SegmentedControlOption<V extends string = string> {
  value: V
  label: ReactNode
  /** A count after the label: compact on screen, the exact count read out. */
  count?: Count
  /**
   * The count in words for a screen reader ("9 with incident"). Default: the exact count. Say
   * the meaning here whenever the option has a `tone`.
   */
  countLabel?: string
  /** An alarming count: a tone icon of its own shape before the number, which stays neutral. */
  tone?: SegmentedCountTone
}

const TONE_GLYPH = { danger: CircleX, warning: TriangleAlert } as const

function OptionCount({
  count,
  countLabel,
  tone,
}: Pick<SegmentedControlOption, "count" | "countLabel" | "tone">) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 font-normal tabular-nums">
      {tone && <Icon icon={TONE_GLYPH[tone]} dense className={TONE_ICON[tone]} />}
      <span aria-hidden="true">{formatCompactCount(count)}</span>
      <span className="sr-only">{countLabel ?? formatCount(count)}</span>
    </span>
  )
}

/**
 * A segmented switch (the webview's scope filter, CI §8): segments of the density's segment
 * height (24 px, 32 px on touch) 2 px inside a box on the ground, with concentric radii. Each
 * segment has a 2 px edge, transparent until it is checked: the checked one takes the hover fill
 * at 600 with an `--interaction` edge, a border, not a ring, so a Windows contrast theme keeps it
 * (theme.css draws it in Highlight there and an unchecked one's in Canvas, as for line tabs).
 * Never underlined. The focus ring sits inside.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<SegmentedControlOption<V>>
  value: V
  onChange: (next: V) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "border-border bg-background text-dense inline-flex gap-0.5 rounded-sm border p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-slot="segmented-option"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "min-h-segment inline-flex items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] border-2 border-transparent px-2.5 transition-colors",
            FOCUS_RING_INSET,
            value === option.value
              ? "bg-accent text-foreground border-interaction font-semibold"
              : "text-muted-foreground hover:bg-accent hover:text-foreground font-normal",
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <OptionCount count={option.count} countLabel={option.countLabel} tone={option.tone} />
          )}
        </button>
      ))}
    </div>
  )
}
