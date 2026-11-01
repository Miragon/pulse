import { useId, type ReactNode } from "react"
import { ChevronRight, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"
import { FOCUS_RING_INSET, FOCUS_RING } from "../lib/focus-ring.js"
import {
  resolveTone,
  TONE_BORDER,
  TONE_DOT,
  TONE_ICON,
  TONE_TINT,
  type ToneName,
  type ToneVariant,
} from "../lib/tone-utils.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"
import { Skeleton } from "../primitives/skeleton.js"

type TrendDirection = "up" | "down" | "flat"

/**
 * Direction → tone when no `trendTone` is set (incident-biased: up reads as
 * worse). The tone shows ONLY as the direction icon's colour or a dot; the
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
   * Explicit tone of the trend — overrides the direction's default. Shown as
   * the direction icon's colour, or as a dot when there is no direction.
   */
  trendTone?: ToneName
  /**
   * The state the figure stands for (e.g. `"danger"` for a breached metric),
   * shown as a dot next to the label (strip) or as the card's tint and edge
   * (`variant="soft"`). The figure itself stays in the foreground colour.
   */
  tone?: ToneName
  /** When set, the cell renders as a button — turns a metric into a nav entry point. */
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
  /** Group label of the strip header (13 px semibold, normal case). */
  label: ReactNode
  /** Optional muted badge to the right of the label. */
  badge?: ReactNode
}

export interface KpiGridProps {
  /** The metric cells, flowed as columns (1–6; more wrap onto further rows). */
  cells: KpiCell[]
  /** Wrap the strip in a bordered card with an optional group `header`. Default `false`. */
  boxed?: boolean
  /** Group header above the strip (strip variant), usually with `boxed`. */
  header?: KpiGridHeader
  /**
   * `"strip"` (default): one bordered strip, the tone as a dot next to the
   * label. `"soft"`: one card per cell in its tone's tint and edge (`boxed`
   * and `header` don't apply).
   */
  variant?: "strip" | "soft"
  /** Names the group of metrics (`role="group"`); omit when a heading right above names it. */
  ariaLabel?: string
  className?: string
}

/** A small status dot; decorative — the label next to it carries the meaning. */
function ToneDot({ tone, className }: { tone: ToneVariant; className: string }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn("shrink-0 rounded-full", className, TONE_DOT[tone])}
    />
  )
}

/**
 * The trend line: neutral words (the foreground next to a state, quiet
 * without one) and the state beside them as a direction icon or a dot in the
 * tone — never as coloured digits.
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
  const Icon = direction ? TREND_ICON[direction] : undefined
  return (
    <div data-slot="kpi-trend" className="text-small mt-1.5 flex items-center gap-1.5">
      {Icon ? (
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", TONE_ICON[tone])} />
      ) : (
        marked && <ToneDot tone={tone} className="size-1.5" />
      )}
      <span className={marked ? "text-foreground" : "text-muted-foreground"}>{cell.trend}</span>
    </div>
  )
}

/** Label, figure, fraction and trend — shared by the strip and soft variants. */
function KpiCellBody({ cell, variant }: { cell: KpiCell; variant: "strip" | "soft" }) {
  const tone = resolveTone(cell.tone)
  return (
    <>
      <div
        className={cn(
          "text-small flex items-center justify-between gap-2 font-medium",
          variant === "strip" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {variant === "strip" && tone !== "neutral" && <ToneDot tone={tone} className="size-2" />}
          <span className="min-w-0 break-words">{cell.label}</span>
        </span>
        {cell.onClick && <ChevronRight aria-hidden="true" className="size-4 shrink-0" />}
      </div>
      <div className="text-title text-foreground mt-1.5 leading-none tracking-tight break-words tabular-nums">
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

/** One cell: a button when clickable (named by its visible text), else a plain box. */
function KpiCellView({
  cell,
  variant,
  className,
}: {
  cell: KpiCell
  variant: "strip" | "soft"
  className: string
}) {
  const hintId = useId()
  const body = <KpiCellBody cell={cell} variant={variant} />
  const tone = cell.tone === undefined ? undefined : resolveTone(cell.tone)
  if (!cell.onClick) {
    return (
      <div data-tone={tone} className={className}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={cell.onClick}
      aria-label={cell.ariaLabel}
      aria-describedby={cell.actionHint ? hintId : undefined}
      data-tone={tone}
      className={cn(
        "cursor-pointer text-left transition-colors",
        variant === "strip" ? cn("hover:bg-muted", FOCUS_RING_INSET) : FOCUS_RING,
        className,
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

/** A soft card: the tone's tint and edge around neutral text. */
function softCardClass(tone: ToneName | undefined): string {
  const t = resolveTone(tone)
  return cn("text-foreground rounded-lg border p-4", TONE_TINT[t], TONE_BORDER[t])
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
const STRIP_CELL = "border-border min-w-0 border-r border-b px-5 py-4"

function KpiStripHeader({ header }: { header: KpiGridHeader }) {
  return (
    <div
      className={cn(
        "border-border bg-muted text-muted-foreground flex items-center gap-2 border-b px-4 py-2",
        MICRO_LABEL,
      )}
    >
      <span>{header.label}</span>
      {header.badge && (
        <span className="border-border bg-card text-muted-foreground text-small rounded-sm border px-1.5 font-medium">
          {header.badge}
        </span>
      )}
    </div>
  )
}

/**
 * A row of headline metrics — the canonical way to show KPIs in a widget
 * (replaces the single-metric KPICard). Cells flow as columns (1–6), falling
 * back to 2 columns in narrow frames. A cell's `tone` shows as a dot next to
 * its label (or as a soft card's tint and edge); figures stay in the
 * foreground colour. A clickable cell is a button whose accessible name is
 * its visible label and value; `actionHint` describes what the click does.
 */
export function KpiGrid({
  cells,
  boxed = false,
  header,
  variant = "strip",
  ariaLabel,
  className,
}: KpiGridProps) {
  const colClass = kpiColumns(cells.length)
  const group = ariaLabel ? { role: "group" as const, "aria-label": ariaLabel } : {}
  if (variant === "soft") {
    return (
      <div {...group} data-slot="kpi-grid" className={cn("grid gap-4", colClass, className)}>
        {cells.map((cell, idx) => (
          <KpiCellView
            key={idx}
            cell={cell}
            variant="soft"
            className={cn("min-w-0", softCardClass(cell.tone))}
          />
        ))}
      </div>
    )
  }
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
            <KpiCellView key={idx} cell={cell} variant="strip" className={STRIP_CELL} />
          ))}
        </div>
      </div>
    </div>
  )
}

export interface KpiGridSkeletonProps {
  /** How many cells the loaded grid will have. */
  cells: number
  /** The loaded grid's variant. Default `"strip"`. */
  variant?: "strip" | "soft"
  /** The loaded grid's `boxed`. Default `false`. */
  boxed?: boolean
  className?: string
}

/**
 * Loading placeholder with {@link KpiGrid}'s geometry (same wrapper, grid and
 * cell padding in both variants), so the layout doesn't jump when the data
 * arrives. `aria-busy`; pair it with a status line if the wait is long.
 */
export function KpiGridSkeleton({
  cells,
  variant = "strip",
  boxed = false,
  className,
}: KpiGridSkeletonProps) {
  const colClass = kpiColumns(cells)
  const count = Math.max(Math.trunc(cells) || 0, 0)
  if (variant === "soft") {
    return (
      <div aria-busy="true" className={cn("grid gap-4", colClass, className)}>
        {Array.from({ length: count }, (_, idx) => (
          <div key={idx} className="bg-muted border-border rounded-lg border p-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-2 h-7 w-14" />
          </div>
        ))}
      </div>
    )
  }
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
              <Skeleton className="mt-2.5 h-7 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
