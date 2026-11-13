import { EMPTY, NBSP, unitLanguage } from "./locale.js"
import { formatNumber } from "./numbers.js"

const DURATION_UNITS = {
  en: { ms: "ms", s: "s", min: "m", h: "h", d: "d", gap: "" },
  de: { ms: "ms", s: "s", min: "Min.", h: "h", d: "d", gap: NBSP },
} as const

/**
 * The one duration form, in its two largest units: English `420ms`, `3m 7s`, `1h 24m`, `2d 3h`;
 * German `3 Min. 7 s`, `2 d 3 h`. Fractional milliseconds are rounded.
 */
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
  const h = Math.floor(m / 60)
  if (h < 24) return `${part(h, units.h)} ${part(m % 60, units.min)}`
  return `${part(Math.floor(h / 24), units.d)} ${part(h % 24, units.h)}`
}
