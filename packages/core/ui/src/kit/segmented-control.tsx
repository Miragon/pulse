import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { CircleX, TriangleAlert } from "lucide-react"
import type { Count } from "../format/index.js"
import { compactCountText, countWords } from "../lib/count-words.js"
import { cn } from "../lib/utils.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { useUiLocale, useUiMessages } from "../locale/locale-provider.js"
import { Icon } from "./icon.js"
import { useResetOnChange } from "./use-reset-on-change.js"

/** An alarming count's tone: its icon has a shape of its own, so colour is never the only signal. */
export type SegmentedCountTone = "danger" | "warning"

export interface SegmentedControlOption<V extends string = string> {
  value: V
  label: ReactNode
  /**
   * A count after the label: compact on screen (`12.3k`, `2k+`, `—`), exact for a screen reader
   * (`12,345`, "at least 2,000", "count unknown"), both in the kit's locale like the words.
   */
  count?: Count
  /**
   * The count in words for a screen reader ("9 with incident"). Default: the exact count. Say
   * the meaning here whenever the option has a `tone`.
   */
  countLabel?: string
  /** An alarming count: a tone icon of its own shape before the number, which stays neutral. */
  tone?: SegmentedCountTone
  /**
   * A note on the option, its title and so its accessible description: what it leaves out, why
   * its count is a lower bound.
   */
  note?: string
}

export interface SegmentedControlProps<V extends string> {
  options: ReadonlyArray<SegmentedControlOption<V>>
  /** The checked option. */
  value: V
  /**
   * Called with the option you check: by a click, by Space or Enter, or by an arrow key, Home or
   * End, which move the check and the focus together. Never for the option already checked.
   */
  onChange: (next: V) => void
  /** The group's name: a radio group needs one. */
  ariaLabel: string
  /**
   * The change runs (what the option shows loads): the group is `aria-busy`. Pass it (`false`
   * until a change runs) when your host applies a change late: the segment you pick shows checked
   * at once and stays so until `value` follows or `busy` ends without it, so the check never snaps
   * back meanwhile. Without it the group is controlled alone and shows `value`, so a change you
   * decline goes back at once.
   */
  busy?: boolean
  /**
   * The group takes no change (a read-only form field): every segment is disabled, opaque and
   * out of the tab order, the checked one still shown checked.
   */
  disabled?: boolean
  className?: string
}

/** The keys that move the check, from the focused option's index among `length` options. */
const MOVES: Readonly<Record<string, (index: number, length: number) => number>> = {
  ArrowRight: (index, length) => (index + 1) % length,
  ArrowDown: (index, length) => (index + 1) % length,
  ArrowLeft: (index, length) => (index - 1 + length) % length,
  ArrowUp: (index, length) => (index - 1 + length) % length,
  Home: () => 0,
  End: (_index, length) => length - 1,
}

const TONE_GLYPH = { danger: CircleX, warning: TriangleAlert } as const

function OptionCount({
  count,
  countLabel,
  tone,
}: Pick<SegmentedControlOption, "count" | "countLabel" | "tone">) {
  const words = useUiMessages().count
  const locale = useUiLocale()
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 font-normal tabular-nums">
      {tone && <Icon icon={TONE_GLYPH[tone]} dense className={TONE_ICON[tone]} />}
      <span aria-hidden="true">{compactCountText(count, locale)}</span>
      <span className="sr-only">{countLabel ?? countWords(count, words, locale)}</span>
    </span>
  )
}

/**
 * The option shown checked. For a host that runs its changes (`busy` given), the one picked while
 * `value` has not followed yet, so a change applied late never snaps the check back meanwhile;
 * the pick goes once `value` changes, or once `busy` ends without it changing. Without `busy`
 * there is no pick to hold: the group shows `value`, as any controlled input.
 */
function useShownValue<V extends string>(value: V, busy: boolean | undefined) {
  const [pending, setPending] = useState<{ to: V } | null>(null)
  useResetOnChange(value, () => setPending(null))
  useResetOnChange(busy, () => {
    if (!busy) setPending(null)
  })
  const runs = busy !== undefined
  const shown = runs && pending ? pending.to : value
  const pick = (next: V) => {
    if (runs) setPending(next === value ? null : { to: next })
  }
  return { shown, pick }
}

/**
 * A segmented switch (the webview's scope filter, CI §8): a radio group of segments of the
 * density's segment height (24 px, 32 px on touch) 2 px inside a box on the ground, with
 * concentric radii. One tab stop, the checked segment; the arrow keys, Home and End move the
 * check and the focus together. Each segment has a 2 px edge, transparent until it is checked: the
 * checked one takes the hover fill at 600 with an `--interaction` edge, a border, not a ring, so a
 * Windows contrast theme keeps it (theme.css draws it in Highlight there and an unchecked one's in
 * Canvas, as for line tabs). Never underlined. The focus ring sits inside. While a change runs
 * (`busy`) the group is `aria-busy` and the picked segment shows checked before `value` follows.
 * A `disabled` group (a read-only field) keeps its check and takes no change, opaque, never faded.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  busy,
  disabled = false,
  className,
}: SegmentedControlProps<V>) {
  const { shown, pick } = useShownValue(value, busy)
  const segments = useRef<Array<HTMLButtonElement | null>>([])
  const select = (next: V) => {
    if (next === shown) return
    pick(next)
    onChange(next)
  }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const move = MOVES[event.key]
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const next = move(index, options.length)
    const option = options[next]
    if (!option) return
    select(option.value)
    segments.current[next]?.focus()
  }
  const stop = options.some((option) => option.value === shown) ? shown : options[0]?.value
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-busy={busy === true}
      aria-disabled={disabled || undefined}
      data-slot="segmented-control"
      className={cn(
        "border-border bg-background text-dense inline-flex gap-0.5 rounded-sm border p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === shown
        return (
          <button
            key={option.value}
            ref={(segment) => {
              segments.current[index] = segment
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={option.value === stop ? 0 : -1}
            disabled={disabled}
            title={option.note}
            data-slot="segmented-option"
            data-state={checked ? "checked" : "unchecked"}
            onClick={() => select(option.value)}
            onKeyDown={(event) => keyDown(event, index)}
            className={cn(
              "min-h-segment inline-flex items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] border-2 border-transparent px-2.5 transition-colors disabled:cursor-not-allowed",
              FOCUS_RING_INSET,
              checked
                ? "bg-accent text-foreground border-interaction font-semibold"
                : "text-muted-foreground hover:bg-accent hover:text-foreground disabled:text-muted-foreground font-normal disabled:bg-transparent",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <OptionCount count={option.count} countLabel={option.countLabel} tone={option.tone} />
            )}
          </button>
        )
      })}
    </div>
  )
}
