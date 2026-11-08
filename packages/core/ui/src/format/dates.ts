import { EMPTY, localeTag, unitLanguage, zoned } from "./locale.js"

function parseDate(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  return parseDate(iso)?.toLocaleString(localeTag(), zoned()) ?? EMPTY
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  return parseDate(iso)?.toLocaleDateString(localeTag(), zoned()) ?? EMPTY
}

export interface TimeOptions {
  /** Default true; false shows hours and minutes only. */
  seconds?: boolean
  /** Adds the milliseconds (`09:05:07.042`), so runs a few milliseconds apart stay apart. */
  milliseconds?: boolean
}

const MINUTES: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }
const SECONDS: Intl.DateTimeFormatOptions = { ...MINUTES, second: "2-digit" }
const MILLISECONDS: Intl.DateTimeFormatOptions = { ...SECONDS, fractionalSecondDigits: 3 }

function timeParts(opts: TimeOptions): Intl.DateTimeFormatOptions | undefined {
  if (opts.milliseconds) return MILLISECONDS
  return opts.seconds === false ? MINUTES : undefined
}

function timeOf(date: Date, opts: TimeOptions): string {
  return date.toLocaleTimeString(localeTag(), zoned(timeParts(opts)))
}

export function formatTime(iso: string | null | undefined, opts: TimeOptions = {}): string {
  if (!iso) return EMPTY
  const date = parseDate(iso)
  return date ? timeOf(date, opts) : EMPTY
}

export interface ClockOptions extends TimeOptions {
  /** The moment whose day counts as today; default now. */
  now?: Date
}

function sameDay(a: Date, b: Date): boolean {
  return a.toLocaleDateString("en", zoned()) === b.toLocaleDateString("en", zoned())
}

/**
 * The time of day alone when it falls on today in the view's time zone, else with its day before
 * it (`09:05` / `Oct 21, 09:05`): for a list or a stamp, where the day is mostly today.
 */
export function formatClock(iso: string | null | undefined, opts: ClockOptions = {}): string {
  if (!iso) return EMPTY
  const date = parseDate(iso)
  if (!date) return EMPTY
  if (sameDay(date, opts.now ?? new Date())) return timeOf(date, opts)
  const day: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  return date.toLocaleString(localeTag(), zoned({ ...day, ...(timeParts(opts) ?? SECONDS) }))
}

/** The full instant in the view's time zone and in UTC, for a tooltip beside a clock. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return EMPTY
  const date = parseDate(iso)
  if (!date) return EMPTY
  const full: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "long" }
  const utc = date.toLocaleString(localeTag(), { ...full, timeZone: "UTC" })
  return `${date.toLocaleString(localeTag(), zoned(full))} · ${utc}`
}

const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

const UNDER_A_MINUTE = {
  en: { past: "just now", future: "in under a minute" },
  de: { past: "gerade eben", future: "in unter einer Minute" },
} as const

/**
 * How far `iso` lies from `now` in its largest whole unit, from minutes to days (`5m ago`,
 * `vor 5 Min.`, `in 2h`); under a minute in words.
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return EMPTY
  const date = parseDate(iso)
  if (!date) return EMPTY
  const elapsed = date.getTime() - now.getTime()
  const language = unitLanguage()
  // German's narrow units read as metres ("vor 5 m"); its short ones do not ("vor 5 Min.").
  const relative = new Intl.RelativeTimeFormat(localeTag(), {
    numeric: "always",
    style: language === "de" ? "short" : "narrow",
  })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) return relative.format(Math.round(elapsed / size), unit)
  }
  return elapsed >= 0 ? UNDER_A_MINUTE[language].future : UNDER_A_MINUTE[language].past
}
