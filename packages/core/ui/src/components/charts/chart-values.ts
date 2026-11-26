import { formatDuration, formatNumber, formatPercent, type Count } from "../../format/index.js"
import { EMPTY, NBSP } from "../../format/locale.js"
import { compactCountText, countText, countWords } from "../../lib/count-words.js"
import type { UiMessages } from "../../locale/message-types.js"
import type { ChartUnit } from "./chart-types.js"

/**
 * A chart's numbers in words and on its axis, each through the kit's formatters: counts in the
 * kit's locale like the words around them (`TabCount`'s), durations and percentages in the
 * formatters' locale. Pure, so the scale and the words are tested without a render.
 */

/** The number a value draws: an exact one, a lower bound's bound, or `null` for none. */
export function boundOf(value: Count): number | null {
  const n = typeof value === "object" && value !== null ? value.atLeast : value
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

const isLowerBound = (value: Count): boolean => typeof value === "object" && value !== null

/** The words a value needs where the screen shows a sign: a lower bound and no value. */
export interface ValueWords {
  count: UiMessages["count"]
  common: Pick<UiMessages["common"], "noValue">
}

/** A value on screen (`1,234`, `≥ 2,000`, `3m 7s`, `—`) and as a screen reader hears it. */
export interface ValueText {
  shown: string
  spoken: string
}

/** The most fraction digits a percentage takes to say a part is neither none nor all. */
const PERCENT_DIGITS_MAX = 6

/**
 * A percentage (percent units: 3.7 means 3.7 %) in at most `digits` fraction digits, more where
 * fewer would round a part to 0 % or short of the whole to 100 %: a share that is not zero never
 * reads as none (`0.03%`), nor one short of the whole as all (`99.97%`).
 */
export function percentText(percent: number, digits: number): string {
  let fraction = Math.max(0, digits)
  const roundsTo = (end: number) =>
    percent !== end && Math.round(percent * 10 ** fraction) / 10 ** fraction === end
  while (fraction < PERCENT_DIGITS_MAX && (roundsTo(0) || roundsTo(100))) fraction += 1
  return formatPercent(percent, { maximumFractionDigits: fraction })
}

/** The fraction digits an axis stepping by `step` needs, so each tick reads apart: 0.05 takes 2. */
function stepDigits(step: number): number {
  return Number.isFinite(step) && step > 0 ? Math.max(0, -Math.floor(Math.log10(step))) : 0
}

function unitText(n: number, unit: Exclude<ChartUnit, "count">): string {
  return unit === "duration" ? formatDuration(n) : percentText(n, 1)
}

/**
 * A value as the tooltip and the table write it: a count as `TabCount` does (`at least 2,000`
 * spoken where `≥ 2,000` shows, `count unknown` where `—` shows), a duration or a share through
 * its formatter (a share in the digits that keep a part from reading as 0 %), `no value` spoken
 * where it has none.
 */
export function valueText(
  value: Count,
  unit: ChartUnit,
  words: ValueWords,
  locale: string,
): ValueText {
  if (unit === "count") {
    return { shown: countText(value, locale), spoken: countWords(value, words.count, locale) }
  }
  const n = boundOf(value)
  if (n === null) return { shown: EMPTY, spoken: words.common.noValue }
  const text = unitText(n, unit)
  if (!isLowerBound(value)) return { shown: text, spoken: text }
  return { shown: `≥${NBSP}${text}`, spoken: words.count.atLeast({ count: text }) }
}

/** Where an axis of counts turns compact (`10k`): from ten thousand, under it in full. */
const COMPACT_AXIS_FROM = 10_000

/**
 * A tick's label on the axis `ticks` (from zero, in even steps): counts in full under ten
 * thousand and compact on an axis that reaches it (one style per axis), shares in the fraction
 * digits their step needs (`0.05%` on an axis of 0.05 steps), so no two ticks read alike.
 */
export function tickText(
  n: number,
  unit: ChartUnit,
  ticks: readonly number[],
  locale: string,
): string {
  // The zero line reads 0 on every axis, never "0ms" under an axis of minutes.
  if (unit === "duration") return n === 0 ? formatNumber(0) : formatDuration(n)
  if (unit === "percent") {
    const step = (ticks[1] ?? 1) - (ticks[0] ?? 0)
    return formatPercent(n, { maximumFractionDigits: stepDigits(step) })
  }
  const top = ticks[ticks.length - 1] ?? 0
  return top >= COMPACT_AXIS_FROM ? compactCountText(n, locale) : countText(n, locale)
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The steps a duration axis counts in, so its ticks read as whole units (`30s`, `5m`, `2h`). */
const DURATION_STEPS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
]

/** The smallest 1, 2 or 5 times a power of ten at or above `raw`; a whole one for counts. */
function decimalStep(raw: number, whole: boolean): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  return whole ? Math.max(1, step) : step
}

function stepFor(raw: number, unit: ChartUnit): number {
  if (unit !== "duration") return decimalStep(raw, unit === "count")
  return DURATION_STEPS.find((s) => s >= raw) ?? decimalStep(raw / DAY, true) * DAY
}

/** A number without the float noise of a multiplication (`0.30000000000000004`). */
const clean = (n: number): number => Number(n.toPrecision(12))

/**
 * The ticks of an axis from zero: about `intervals` even steps of a round size up to the first
 * at or above `max`, so no mark reaches past the top tick. An axis with nothing above zero still
 * has one step, so its zero line sits at the foot.
 */
export function niceTicks(max: number, unit: ChartUnit, intervals: number): number[] {
  const top = Number.isFinite(max) && max > 0 ? max : 0
  const raw = top > 0 ? top / Math.max(1, intervals) : 1
  const step = stepFor(raw, unit)
  const count = Math.max(1, Math.ceil(clean(top / step)))
  return Array.from({ length: count + 1 }, (_, i) => clean(i * step))
}

/** The largest number any of `values` draws, 0 when none draws one. */
export function maxOf(values: Iterable<Count>): number {
  let max = 0
  for (const value of values) {
    const n = boundOf(value)
    if (n !== null && n > max) max = n
  }
  return max
}
