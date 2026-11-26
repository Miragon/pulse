import type { ReactNode } from "react"
import type { Count } from "../../format/index.js"
import { NBSP } from "../../format/locale.js"
import { countText, countWords } from "../../lib/count-words.js"
import { cn } from "../../lib/utils.js"
import { useUiLocale, useUiMessages } from "../../locale/locale-provider.js"
import { METER_FILL } from "./chart-series.js"
import { boundOf, percentText } from "./chart-values.js"

/** One row of `MeterRows`: a part of the whole and its count. */
export interface MeterRow {
  /** Unique among the rows. */
  key: string
  /** The part's name (an end event, a step of a funnel). */
  label: ReactNode
  /** The part's count: exact, a lower bound `{ atLeast }` or unknown (`null`, no bar). */
  value: Count
  /** `"incident"` paints the bar in the danger tone: open incidents only. Default the blue ramp. */
  kind?: "incident"
}

export interface MeterRowsProps {
  /** Names the list (its accessible name). */
  label: string
  rows: readonly MeterRow[]
  /**
   * The whole each share is of: the first step of a funnel, all instances that ended. A count
   * like the rows': exact, a lower bound `{ atLeast }` or unknown (`null`). Default the sum of
   * the rows' counts (the parts of one whole), exact only while every row is.
   */
  total?: Count
  className?: string
}

/** The whole the rows are measured against, and whether their shares of it are known. */
interface Whole {
  /** What a full bar stands for. */
  n: number
  /** The shares are known: the whole is exact. Else the bars compare the rows. */
  shares: boolean
}

const isExact = (value: Count): value is number =>
  typeof value === "number" && Number.isFinite(value)

/**
 * An exact whole measures shares; a whole that is a lower bound or unknown (an explicit one, or
 * the sum of rows one of which is) has no share that holds, so the bars compare the rows, the
 * largest a full bar, and no row says a share.
 */
function wholeOf(rows: readonly MeterRow[], total: Count | undefined): Whole {
  if (total === undefined && rows.every((row) => isExact(row.value))) {
    return { n: rows.reduce((sum, row) => sum + (boundOf(row.value) ?? 0), 0), shares: true }
  }
  if (total !== undefined && isExact(total)) return { n: total, shares: true }
  return { n: rows.reduce((max, row) => Math.max(max, boundOf(row.value) ?? 0), 0), shares: false }
}

/** A share in percent: a decimal below 10 %, more where a part would read as 0 % or as all. */
function shareText(share: number): string {
  const percent = share * 100
  return percentText(percent, percent < 10 ? 1 : 0)
}

/**
 * A row's share of an exact whole, on screen and in words: a lower bound's share is one too
 * (`≥ 40%`, "at least 40%"), an unknown count has none.
 */
function ShareText({ value, share }: { value: Count; share: number }) {
  const words = useUiMessages().count
  const text = shareText(share)
  const className = "text-muted-foreground min-w-10 text-right"
  if (isExact(value)) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      <span aria-hidden="true">{`≥${NBSP}${text}`}</span>
      <span className="sr-only">{words.atLeast({ count: text })}</span>
    </span>
  )
}

/** One row: its name, its count and share on one line, the bar under them. */
function MeterRowView({ row, whole }: { row: MeterRow; whole: Whole }) {
  const words = useUiMessages().count
  const locale = useUiLocale()
  const n = boundOf(row.value)
  const fill = n !== null && whole.n > 0 ? n / whole.n : null
  return (
    <li data-slot="meter-row" className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 break-words">{row.label}</span>
        <span className="flex flex-none items-baseline gap-2 tabular-nums">
          <span aria-hidden="true" className="text-foreground">
            {countText(row.value, locale)}
          </span>
          <span className="sr-only">{countWords(row.value, words, locale)}</span>
          {whole.shares && fill !== null && <ShareText value={row.value} share={fill} />}
        </span>
      </div>
      <div
        aria-hidden="true"
        data-slot="meter-track"
        className="bg-muted rounded-pill h-2 overflow-hidden"
      >
        {fill !== null && fill > 0 && (
          <div
            data-slot="meter-fill"
            className={cn("rounded-pill h-full", METER_FILL[row.kind ?? "first"])}
            style={{ width: `${String(Math.min(1, fill) * 100)}%` }}
          />
        )}
      </div>
    </li>
  )
}

/**
 * Shares of a whole, one row per part, for funnels and outcomes: the part's name, its count
 * and its share on one line, a bar of that share under them on the blue ramp over a quiet track,
 * an incident row's in red. The figures are the rows' text, so a screen reader reads the list as
 * it is (a lower bound and an unknown count in words) and needs no tooltip or table; the bars
 * are their picture. A share above the whole fills its bar and says its percentage; a lower
 * bound's share is one too (`≥ 40%`), and no part reads as 0 % or as all unless it is. A whole
 * that is not exact (a lower bound, unknown, or the sum of rows one of which is) has no share
 * that holds: the rows say none, and the bars compare them, the largest a full bar.
 */
export function MeterRows({ label, rows, total, className }: MeterRowsProps) {
  const whole = wholeOf(rows, total)
  return (
    <ul
      aria-label={label}
      data-slot="meter-rows"
      className={cn("text-dense m-0 flex min-w-0 list-none flex-col gap-3 p-0", className)}
    >
      {rows.map((row) => (
        <MeterRowView key={row.key} row={row} whole={whole} />
      ))}
    </ul>
  )
}
