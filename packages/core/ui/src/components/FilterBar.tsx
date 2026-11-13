import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_SOFT } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Input } from "../primitives/input.js"

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
  /** Current search text (controlled). */
  search: string
  /** Placeholder for the search input. Default: the locale's "Filter…". */
  searchPlaceholder?: string
  /**
   * Accessible name of the search input. Default: the locale's "Filter", since a
   * placeholder is no label (it disappears while you type).
   */
  searchAriaLabel?: string
  /** Called with the new search text on every keystroke. */
  onSearchChange: (next: string) => void
  /** Filter chips rendered to the right of the search input. */
  chips: FilterChip[]
  /** Called with a chip id when it is toggled. */
  onChipToggle: (id: string) => void
  /** Names the chip row (`role="group"`). Default: the locale's "Filters". */
  chipsAriaLabel?: string
  className?: string
}

/**
 * Search input + toggleable chip row for filtering a list/table of widget
 * items. The input is labelled; every chip is a toggle button whose state is
 * `aria-pressed`. An active chip is a selection in the CI pattern: the info
 * tint and edge around foreground text. Pair with `useDebouncedValue` to
 * avoid re-querying on every keystroke.
 */
export function FilterBar({
  search,
  searchPlaceholder,
  searchAriaLabel,
  onSearchChange,
  chips,
  onChipToggle,
  chipsAriaLabel,
  className,
}: FilterBarProps) {
  const { filterBar } = useUiMessages()
  return (
    <div data-slot="filter-bar" className={cn("flex flex-wrap items-center gap-2", className)}>
      <Input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder ?? filterBar.searchPlaceholder}
        aria-label={searchAriaLabel ?? filterBar.searchLabel}
        className="text-dense md:text-dense h-9 min-w-[220px] flex-1"
      />
      {chips.length > 0 && (
        <div
          role="group"
          aria-label={chipsAriaLabel ?? filterBar.chipsLabel}
          className="flex flex-wrap gap-1.5"
        >
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.id}
              onClick={() => onChipToggle(chip.id)}
              aria-pressed={Boolean(chip.active)}
              className={cn(
                "text-small inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 transition-colors",
                FOCUS_RING,
                chip.active
                  ? cn(TONE_SOFT.info, TONE_BORDER.info, "font-semibold")
                  : "border-border bg-raised text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {chip.label}
              {chip.count !== undefined && chip.count !== "" && (
                <span className="font-normal tabular-nums">{chip.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
