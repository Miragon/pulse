import { useId, type ReactNode } from "react"
import {
  ChevronRight,
  CircleX,
  Minus,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"
import { resolveTone, type ToneName, type ToneVariant } from "../tones/index.js"
import { Skeleton } from "../primitives/skeleton.js"

type TrendDirection = "up" | "down" | "flat"

/**
 * Direction → tone when no `trendTone` is set (incident-biased: up reads as
 * worse). The tone shows ONLY as the colour of an icon of its own shape; the
 * trend words stay neutral (no coloured digits, CI §3.3).
 */
const TREND_TONE: Record<TrendDirection, ToneVariant> = {
  up: "danger",
  down: "success",
  flat: "neutral",
}

const TREND_ICON: Record<TrendDirection, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
}

/** A trend without a direction that alarms: its tone's icon of its own shape (`CountFigure`'s). */
const ALARM_ICON: Partial<Record<ToneVariant, LucideIcon>> = {
  danger: CircleX,
  warning: TriangleAlert,
}

export interface KpiCell {
  /** Caption shown above the value. Part of the cell's accessible name. */
  label: ReactNode
  /** The headline figure. Pre-format numbers for locale/currency. */
  value: ReactNode
  /** Small fraction shown next to the value, e.g. ` /14`. */
  fraction?: ReactNode
  /** Optional trend line under the value (e.g. `"+12% vs last week"`); its words stay neutral. */
  trend?: ReactNode
  /**
   * Draws a Lucide direction icon (TrendingUp / TrendingDown / Minus) before
   * the trend line, in the trend's tone: `up` reads as bad (danger), `down`
   * as good (success) unless {@link KpiCell.trendTone} says otherwise.
   */
  trendDirection?: TrendDirection
  /**
   * Explicit tone of the trend; overrides the direction's default. Shown as
   * the direction icon's colour; without a direction an alarming tone
   * (danger, warning) draws its icon of its own shape, any other tone only
   * sets the words in the foreground.
   */
  trendTone?: ToneName
  /** When set, the cell renders as a button: it turns a metric into a nav entry point. */
  onClick?: () => void
  /**
   * What activating the cell does ("Opens the incidents dashboard"). Read as
   * the button's DESCRIPTION (`aria-describedby`), so its accessible name
   * stays the visible label and value (WCAG 2.5.3, label in name).
   */
  actionHint?: string
  /**
   * @deprecated Replaces the accessible name with text a voice-control user
   * cannot see (WCAG 2.5.3). Say what the click does in
   * {@link KpiCell.actionHint}; the visible label and value name the cell.
   */
  ariaLabel?: string
}

/**
 * Columns per cell count. 4+ cells fall back to 2 columns in narrow frames
 * (inline chat views are often under 500 px, where five cells side by side
 * leave ~40 px each); 6 steps through 3.
 */
const COL_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
}

/** The responsive column classes for `count` cells (clamped to 1–6). */
export function kpiColumns(count: number): string {
  const cols = Math.min(Math.max(Math.trunc(count) || 1, 1), 6)
  return COL_CLASS[cols] ?? "grid-cols-1"
}

export interface KpiGridHeader {
  /** Group label of the strip's header row (13 px at 600, normal case). */
  label: ReactNode
  /** Optional quiet note after the label (13 px at 400), e.g. the scope the figures span. */
  badge?: ReactNode
}

export interface KpiGridProps {
  /** The metric cells, flowed as columns (1–6; more wrap onto further rows). */
  cells: KpiCell[]
  /** Wrap the strip in a bordered card with an optional group `header`. Default `false`. */
  boxed?: boolean
  /** Group header row above the strip, usually with `boxed`. */
  header?: KpiGridHeader
  /** Names the group of metrics (`role="group"`); omit when a heading right above names it. */
  ariaLabel?: string
  className?: string
}

/**
 * The trend line: neutral words (the foreground next to a state, quiet
 * without one) and the state beside them as an icon in the tone (the
 * direction's, else an alarming tone's own shape), never as coloured digits
 * or a dot whose colour alone carries it.
 */
function TrendLine({ cell }: { cell: KpiCell }) {
  const direction = cell.trendDirection
  const tone =
    cell.trendTone !== undefined
      ? resolveTone(cell.trendTone)
      : direction
        ? TREND_TONE[direction]
        : "neutral"
  const marked = tone !== "neutral"
  const Icon = direction ? TREND_ICON[direction] : ALARM_ICON[tone]
  return (
    <div data-slot="kpi-trend" className="text-small mt-1 flex items-center gap-1.5">
      {Icon && (
        <Icon
          aria-hidden="true"
          data-tone={tone}
          className={cn("size-4 shrink-0", TONE_ICON[tone])}
        />
      )}
      <span className={marked ? "text-foreground" : "text-muted-foreground"}>{cell.trend}</span>
    </div>
  )
}

/**
 * Label, figure, fraction and trend. The figure is neutral: an alarming count shows its alarm as
 * the value's `CountFigure` (its tone's icon of its own shape and its words), never as a tint, a
 * dot or a coloured number.
 */
function KpiCellBody({ cell }: { cell: KpiCell }) {
  return (
    <>
      <div
        className={cn("text-muted-foreground flex items-center justify-between gap-2", MICRO_LABEL)}
      >
        <span className="min-w-0 break-words">{cell.label}</span>
        {cell.onClick && <ChevronRight aria-hidden="true" className="size-4 shrink-0" />}
      </div>
      <div className="text-section text-foreground mt-1 leading-none break-words tabular-nums">
        {cell.value}
        {cell.fraction && (
          <span className="text-dense text-muted-foreground ml-0.5 font-normal">
            {cell.fraction}
          </span>
        )}
      </div>
      {cell.trend && <TrendLine cell={cell} />}
    </>
  )
}

/**
 * The strip's dividers. Each cell draws its own right and bottom rule, and the
 * grid reaches 1 px past its clipping frame, so the rules on the outer edges
 * fall away at any column count. An empty track in a short last row (5 cells
 * in 2 columns, 7 in 6) keeps the card colour: a `gap-px` grid on a
 * `bg-border` container would paint it as a solid block of the divider colour.
 */
const STRIP_FRAME = "bg-card overflow-hidden"
const STRIP_GRID = "-mr-px -mb-px grid"
const STRIP_CELL = "border-border min-w-0 border-r border-b p-3"

/** One cell: a button when clickable (named by its visible text), else a plain box. */
function KpiCellView({ cell }: { cell: KpiCell }) {
  const hintId = useId()
  const body = <KpiCellBody cell={cell} />
  if (!cell.onClick) {
    return <div className={STRIP_CELL}>{body}</div>
  }
  return (
    <button
      type="button"
      onClick={cell.onClick}
      aria-label={cell.ariaLabel}
      aria-describedby={cell.actionHint ? hintId : undefined}
      className={cn(
        "hover:bg-accent cursor-pointer text-left transition-colors",
        FOCUS_RING_INSET,
        STRIP_CELL,
      )}
    >
      {body}
      {/* Referenced by aria-describedby; `hidden` keeps it out of the name and the page. */}
      {cell.actionHint && (
        <span id={hintId} hidden>
          {cell.actionHint}
        </span>
      )}
    </button>
  )
}

/**
 * The strip's header row, flat in the compact look: its label at 13 px and 600 on the card's
 * surface, a quiet note after it, a 1 px rule below; the tiles' 12 px inset on its sides.
 */
function KpiStripHeader({ header }: { header: KpiGridHeader }) {
  return (
    <div
      data-slot="kpi-header"
      className="border-border bg-card flex flex-wrap items-baseline gap-x-2 border-b px-3 py-1.5"
    >
      <span className={cn("text-foreground", MICRO_LABEL)}>{header.label}</span>
      {header.badge && <span className="text-muted-foreground text-small">{header.badge}</span>}
    </div>
  )
}

/**
 * A row of headline metrics, the canonical way to show KPIs in a widget
 * (replaces the single-metric KPICard). Compact: 12 px inside each tile, the
 * caption 4 px above a 21 px figure at 600. Cells flow as columns (1–6), falling
 * back to 2 columns in narrow frames. Every tile is neutral (invariant 6): no
 * tint, no coloured dot, the figure in the foreground; a count that alarms is
 * the value's `CountFigure`, its tone's icon of its own shape before it and its
 * words for a screen reader. A clickable cell is a button whose accessible name
 * is its visible label and value; `actionHint` describes what the click does.
 */
export function KpiGrid({ cells, boxed = false, header, ariaLabel, className }: KpiGridProps) {
  const colClass = kpiColumns(cells.length)
  const group = ariaLabel ? { role: "group" as const, "aria-label": ariaLabel } : {}
  return (
    <div
      {...group}
      data-slot="kpi-grid"
      className={cn(boxed && "border-border overflow-hidden rounded-lg border", className)}
    >
      {header && <KpiStripHeader header={header} />}
      <div data-slot="kpi-strip" className={cn(STRIP_FRAME, !boxed && "border-border border-y")}>
        <div className={cn(STRIP_GRID, colClass)}>
          {cells.map((cell, idx) => (
            <KpiCellView key={idx} cell={cell} />
          ))}
        </div>
      </div>
    </div>
  )
}

export interface KpiGridSkeletonProps {
  /** How many cells the loaded grid will have. */
  cells: number
  /** The loaded grid's `boxed`. Default `false`. */
  boxed?: boolean
  className?: string
}

/**
 * Loading placeholder with {@link KpiGrid}'s geometry (same wrapper, grid and
 * cell padding), so the layout doesn't jump when the data arrives.
 * `aria-busy`; pair it with a status line if the wait is long.
 */
export function KpiGridSkeleton({ cells, boxed = false, className }: KpiGridSkeletonProps) {
  const colClass = kpiColumns(cells)
  const count = Math.max(Math.trunc(cells) || 0, 0)
  return (
    <div
      aria-busy="true"
      className={cn(boxed && "border-border overflow-hidden rounded-lg border", className)}
    >
      <div data-slot="kpi-strip" className={cn(STRIP_FRAME, !boxed && "border-border border-y")}>
        <div className={cn(STRIP_GRID, colClass)}>
          {Array.from({ length: count }, (_, idx) => (
            <div key={idx} className={STRIP_CELL}>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-1.5 h-5 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
