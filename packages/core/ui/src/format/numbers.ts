import { EMPTY, localeTag, NBSP, unitLanguage } from "./locale.js"

// Never `toFixed`/argument-less `toLocaleString()` (ESLint-gated): both ignore the view's locale.

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (!isNumber(value)) return EMPTY
  return new Intl.NumberFormat(localeTag(), options).format(value)
}

/**
 * A count: exact, a lower bound that a capped read vouches for (`{ atLeast }`), or unknown
 * (`null`), which renders "—", never a `0` that reads as fact.
 */
export type Count = number | { atLeast: number } | null | undefined

/** "At least": `≥ 2,000` for an exact count, `10k+` for a compact one. */
const AT_LEAST_PREFIX = `≥${NBSP}`
const AT_LEAST_SUFFIX = "+"

function boundOf(count: Count): { value: number | null | undefined; atLeast: boolean } {
  return typeof count === "object" && count !== null
    ? { value: count.atLeast, atLeast: true }
    : { value: count, atLeast: false }
}

/** `1,234`; a lower bound `≥ 2,000`; unknown `—`. */
export function formatCount(count: Count): string {
  const { value, atLeast } = boundOf(count)
  if (!isNumber(value)) return EMPTY
  const text = formatNumber(value)
  return atLeast ? `${AT_LEAST_PREFIX}${text}` : text
}

/** Where a language starts to shorten: English from a thousand, German from a million. */
const COMPACT_FROM = { en: 1000, de: 1_000_000 } as const

/**
 * Below the language's threshold exact and grouped (`999`, German `12.345`), above it compact in
 * the view's locale (`1.2k`, `1.5M`, German `1,5 Mio.`), a lower bound with a `+` (`10k+`);
 * unknown `—`. English writes the thousands with a small `k` and keeps `M` and `B`, so a million
 * never reads as the minutes of a duration (`3m 7s`). For a narrow place with the exact count
 * beside it (a tooltip, a title).
 */
export function formatCompactCount(count: Count): string {
  const { value, atLeast } = boundOf(count)
  if (!isNumber(value)) return EMPTY
  const language = unitLanguage()
  const text =
    Math.abs(value) < COMPACT_FROM[language]
      ? formatNumber(value)
      : new Intl.NumberFormat(localeTag(), { notation: "compact", maximumFractionDigits: 1 })
          .format(value)
          .replace(/K$/, "k")
  return atLeast ? `${text}${AT_LEAST_SUFFIX}` : text
}

export interface PercentFormatOptions {
  /** Default 1, raised to `minimumFractionDigits` when that is larger. */
  maximumFractionDigits?: number
  /** Default 0; set it equal to the maximum for aligned table columns. */
  minimumFractionDigits?: number
  signed?: boolean
}

function percentOptions(
  options: PercentFormatOptions | undefined,
  signedDefault: boolean,
): Intl.NumberFormatOptions {
  const minimumFractionDigits = options?.minimumFractionDigits ?? 0
  return {
    // Intl throws for a maximum below the minimum, and this runs during render.
    maximumFractionDigits: Math.max(options?.maximumFractionDigits ?? 1, minimumFractionDigits),
    minimumFractionDigits,
    signDisplay: (options?.signed ?? signedDefault) ? "exceptZero" : "auto",
  }
}

/** Takes PERCENT units: 3.7 means 3.7 %. */
export function formatPercent(
  percent: number | null | undefined,
  options?: PercentFormatOptions,
): string {
  if (!isNumber(percent)) return EMPTY
  return new Intl.NumberFormat(localeTag(), {
    style: "percent",
    ...percentOptions(options, false),
  }).format(percent / 100)
}

export function formatPercentPoints(
  points: number | null | undefined,
  options?: PercentFormatOptions,
): string {
  if (!isNumber(points)) return EMPTY
  const n = new Intl.NumberFormat(localeTag(), percentOptions(options, true)).format(points)
  return `${n}${NBSP}${unitLanguage() === "de" ? "Pp." : "pp"}`
}

const PERIOD_UNITS: Record<"de" | "en", Record<string, [one: string, other: string]>> = {
  en: { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"], w: ["week", "weeks"] },
  de: {
    m: ["Minute", "Minuten"],
    h: ["Stunde", "Stunden"],
    d: ["Tag", "Tage"],
    w: ["Woche", "Wochen"],
  },
}

/** "7d" → "7 days"; anything that is not such a token comes back unchanged. */
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return EMPTY
  const match = /^(\d+)\s*([mhdw])$/i.exec(period.trim())
  if (!match) return period
  const count = Number(match[1])
  const [one, other] = PERIOD_UNITS[unitLanguage()][match[2].toLowerCase()]
  return `${formatNumber(count)}${NBSP}${count === 1 ? one : other}`
}
