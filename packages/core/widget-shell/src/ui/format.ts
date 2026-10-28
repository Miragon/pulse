/**
 * The single formatting source (local copies drifted into three duration
 * styles); em-dash for empty input. Renders in the locale ProfileGate
 * publishes via {@link setFormatLocale}, not the iframe browser's.
 */

const EMPTY = "—"

export interface FormatLocale {
  language: string
  /** The host's full tag when it speaks `language`. */
  locale: string
  timeZone?: string
}

let current: FormatLocale | undefined
const listeners = new Set<() => void>()

function sameFormatLocale(a: FormatLocale | undefined, b: FormatLocale | undefined): boolean {
  return a?.language === b?.language && a?.locale === b?.locale && a?.timeZone === b?.timeZone
}

/** A no-op for an unchanged value, so subscribers re-render only on a real change. */
export function setFormatLocale(next: FormatLocale | undefined): void {
  if (sameFormatLocale(current, next)) return
  current = next
  for (const listener of listeners) listener()
}

export function getFormatLocale(): FormatLocale | undefined {
  return current
}

export function subscribeFormatLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function zoned(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  return current?.timeZone ? { ...options, timeZone: current.timeZone } : options
}

function parseDate(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  return parseDate(iso)?.toLocaleString(current?.locale, zoned()) ?? EMPTY
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  return parseDate(iso)?.toLocaleDateString(current?.locale, zoned()) ?? EMPTY
}

export function formatTime(
  iso: string | null | undefined,
  opts: { seconds?: boolean } = {},
): string {
  if (!iso) return EMPTY
  const date = parseDate(iso)
  if (!date) return EMPTY
  return opts.seconds === false
    ? date.toLocaleTimeString(current?.locale, zoned({ hour: "2-digit", minute: "2-digit" }))
    : date.toLocaleTimeString(current?.locale, zoned())
}

// Never `toFixed`/argument-less `toLocaleString()` (ESLint-gated): both ignore the view's locale.

/** A non-breaking space: a number never wraps away from its unit. */
const NBSP = " "

function unitLanguage(): "de" | "en" {
  return current?.language.toLowerCase().startsWith("de") ? "de" : "en"
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (!isNumber(value)) return EMPTY
  return new Intl.NumberFormat(current?.locale, options).format(value)
}

export interface PercentFormatOptions {
  /** Default 1, raised to `minimumFractionDigits` when that is larger. */
  maximumFractionDigits?: number
  /** Default 0 — set it equal to the maximum for aligned table columns. */
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
  return new Intl.NumberFormat(current?.locale, {
    style: "percent",
    ...percentOptions(options, false),
  }).format(percent / 100)
}

export function formatPercentPoints(
  points: number | null | undefined,
  options?: PercentFormatOptions,
): string {
  if (!isNumber(points)) return EMPTY
  const n = new Intl.NumberFormat(current?.locale, percentOptions(options, true)).format(points)
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

const DURATION_UNITS = {
  en: { ms: "ms", s: "s", min: "m", h: "h", gap: "" },
  de: { ms: "ms", s: "s", min: "Min.", h: "h", gap: NBSP },
} as const

/** English `3m 7s`, German `3 Min. 7 s`; fractional ms are rounded. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return EMPTY
  const units = DURATION_UNITS[unitLanguage()]
  const part = (n: number, unit: string) => `${formatNumber(n)}${units.gap}${unit}`
  const total = Math.round(ms)
  if (total < 1000) return part(total, units.ms)
  const s = Math.floor(total / 1000)
  if (s < 60) return part(s, units.s)
  const m = Math.floor(s / 60)
  if (m < 60) return `${part(m, units.min)} ${part(s % 60, units.s)}`
  return `${part(Math.floor(m / 60), units.h)} ${part(m % 60, units.min)}`
}

export function truncate(value: string | null | undefined, max: number): string {
  if (!value) return EMPTY
  return value.length > max ? value.slice(0, max) + "…" : value
}
