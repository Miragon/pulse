import { cn } from "@miragon/mcp-toolkit-ui"
import type { Locale } from "../profile-constants.js"
import { formatDate, formatNumber, formatPeriod, formatTime, getFormatLocale } from "./format.js"

/**
 * Period, engine set and as-of time under a view title (U7). Each part is
 * left out when unknown, never guessed.
 */

export interface ViewMetaEngines {
  count: number
  /** Of those, how many report no metrics; omit when unknown. */
  silent?: number | null
}

export interface ViewMetaParts {
  /** What the figures are about, first on the line (a process key, "v1 → v2"). */
  subject?: string | null
  /** Omit for a live snapshot. */
  period?: string | null
  engines?: ViewMetaEngines | null
  /** When the figures were read (ISO timestamp); shown as "Stand 14:32". */
  asOf?: string | null
}

/** Run through the catalog text test. */
export interface ViewMetaLabels {
  /** `count` decides the plural, `n` is the formatted number. */
  engines: (p: { count: number; n: string }) => string
  silent: (p: { n: string }) => string
  asOf: (p: { time: string }) => string
  /** "Letzte 7 Tage" around a formatted period ("7 Tage"). */
  last: (p: { period: string }) => string
  lastHour: string
  lastMinute: string
}

export const VIEW_META_LABELS: Readonly<Record<Locale, ViewMetaLabels>> = {
  en: {
    engines: ({ count, n }) => (count === 1 ? "1 engine" : `${n} engines`),
    silent: ({ n }) => `(${n} without metrics)`,
    asOf: ({ time }) => `As of ${time}`,
    last: ({ period }) => `Last ${period}`,
    lastHour: "Last hour",
    lastMinute: "Last minute",
  },
  de: {
    engines: ({ count, n }) => (count === 1 ? "1 Engine" : `${n} Engines`),
    silent: ({ n }) => `(${n} ohne Metriken)`,
    asOf: ({ time }) => `Stand ${time}`,
    last: ({ period }) => `Letzte ${period}`,
    lastHour: "Letzte Stunde",
    lastMinute: "Letzte Minute",
  },
}

const SEPARATOR = " · "

function labels(): ViewMetaLabels {
  return VIEW_META_LABELS[getFormatLocale()?.language.toLowerCase().startsWith("de") ? "de" : "en"]
}

/** A single day reads as its length ("Letzte 24 Stunden"): "Letzter Tag" would read as yesterday. */
export function formatLookback(period: string | null | undefined): string {
  if (!period) return ""
  const match = /^(\d+)\s*([mhdw])$/i.exec(period.trim())
  if (!match) return period
  const count = Number(match[1])
  const unit = match[2].toLowerCase()
  const l = labels()
  if (count === 1) {
    if (unit === "m") return l.lastMinute
    if (unit === "h") return l.lastHour
    return l.last({ period: formatPeriod(unit === "d" ? "24h" : "7d") })
  }
  return l.last({ period: formatPeriod(`${count}${unit}`) })
}

/** "14:32" for a time today, "10.10.2026, 14:32" for an older one. */
function asOfTime(iso: string, now: Date): string {
  const time = formatTime(iso, { seconds: false })
  const sameDay = formatDate(iso) === formatDate(now.toISOString())
  return sameDay ? time : `${formatDate(iso)}, ${time}`
}

export function formatViewMeta(parts: ViewMetaParts, now: Date = new Date()): string {
  const l = labels()
  const out: string[] = []
  if (parts.subject) out.push(parts.subject)
  if (parts.period) out.push(parts.period)
  if (parts.engines) {
    const { count, silent } = parts.engines
    const engines = l.engines({ count, n: formatNumber(count) })
    out.push(silent ? `${engines} ${l.silent({ n: formatNumber(silent) })}` : engines)
  }
  if (parts.asOf && !Number.isNaN(new Date(parts.asOf).getTime())) {
    out.push(l.asOf({ time: asOfTime(parts.asOf, now) }))
  }
  return out.join(SEPARATOR)
}

export function ViewMeta({ className, ...parts }: ViewMetaParts & { className?: string }) {
  const text = formatViewMeta(parts)
  if (!text) return null
  return (
    <p data-view-meta="" className={cn("text-muted-foreground text-small", className)}>
      {text}
    </p>
  )
}
