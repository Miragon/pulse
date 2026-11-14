import type { ReactNode } from "react"
import { SearchField } from "../kit/search-field.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_SOFT } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Toolbar } from "./Toolbar.js"

export interface FilterChip {
  /** Stable id passed back to `onChipToggle`. */
  id: string
  /** Visible chip label (its accessible name, with the count). */
  label: string
  /** Optional count rendered after the label. */
  count?: number | string
  /** Whether the chip is currently active (`aria-pressed`). */
  active?: boolean
}

export interface FilterBarProps {
  /** The search in effect (controlled): what the list is filtered by now. */
  search: string
  /** Placeholder for the search input. Default: the locale's "Filter…". */
  searchPlaceholder?: string
  /**
   * Accessible name of the search input. Default: the locale's "Filter", since a
   * placeholder is no label (it disappears while you type).
   */
  searchAriaLabel?: string
  /**
   * Called with the trimmed search text as you type (the field adds no delay of its own), at
   * once on Enter, its clear button and Escape; never twice in a row with the same text.
   */
  onSearchChange: (next: string) => void
  /** Filter chips rendered to the right of the search input. */
  chips: FilterChip[]
  /** Called with a chip id when it is toggled. */
  onChipToggle: (id: string) => void
  /** Names the chip row (`role="group"`). Default: the locale's "Filters". */
  chipsAriaLabel?: string
  /** A line on what the list shows, at the bar's end ("Showing 20 of 160"). */
  summary?: ReactNode
  className?: string
}

/**
 * A `Toolbar` with a `SearchField` and a row of toggle chips for filtering a list or table of
 * widget items: 36 px high with a rule below. The field is labelled; every chip is a toggle
 * button whose state is `aria-pressed`, a 28 px pill up to 240 px wide (its whole label in its
 * title). An active chip is a selection in the CI pattern: the info tint and edge around
 * foreground text. Pair with `useDebouncedValue` to avoid re-querying on every keystroke. A
 * condition you remove or edit is a `ConditionChip`.
 */
export function FilterBar({
  search,
  searchPlaceholder,
  searchAriaLabel,
  onSearchChange,
  chips,
  onChipToggle,
  chipsAriaLabel,
  summary,
  className,
}: FilterBarProps) {
  const { filterBar } = useUiMessages()
  return (
    <Toolbar summary={summary} className={className}>
      <SearchField
        value={search}
        onChange={onSearchChange}
        delayMs={0}
        placeholder={searchPlaceholder ?? filterBar.searchPlaceholder}
        aria-label={searchAriaLabel ?? filterBar.searchLabel}
      />
      {chips.length > 0 && (
        <div
          role="group"
          aria-label={chipsAriaLabel ?? filterBar.chipsLabel}
          className="flex min-w-0 flex-wrap gap-1.5"
        >
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.id}
              title={chip.label}
              onClick={() => onChipToggle(chip.id)}
              aria-pressed={Boolean(chip.active)}
              className={cn(
                "text-dense min-h-control rounded-pill inline-flex max-w-60 min-w-0 items-center gap-1.5 border px-2.5 transition-colors",
                FOCUS_RING,
                chip.active
                  ? cn(TONE_SOFT.info, TONE_BORDER.info, "font-semibold")
                  : "border-border bg-raised text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              {chip.count !== undefined && chip.count !== "" && (
                <span className="font-normal tabular-nums">{chip.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </Toolbar>
  )
}
