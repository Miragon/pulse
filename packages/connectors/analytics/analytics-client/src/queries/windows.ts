import { RETENTION_DAYS } from "../prometheus.js"

export const DAY_SECONDS = 86_400

export const nowSeconds = () => Math.floor(Date.now() / 1000)

export interface ClampedWindow {
  from: number
  to: number
  seconds: number
  partial: boolean
}

/**
 * Prometheus answers a future `@` with whatever exists so far and a
 * pre-retention one with nothing: an unclamped window silently reads a
 * fraction of its span while being reported at full length.
 */
export function clampWindow(
  name: string,
  from: number,
  to: number,
  now: number = nowSeconds(),
): ClampedWindow {
  if (to <= from) {
    throw new Error(`${name}: the window ends before it starts — swap from and to`)
  }
  const oldest = now - RETENTION_DAYS * DAY_SECONDS
  if (from >= now) {
    throw new Error(`${name}: the window lies in the future — no metrics exist for it yet`)
  }
  if (to <= oldest) {
    throw new Error(
      `${name}: the window lies before the ${RETENTION_DAYS}-day Prometheus retention — its metrics are gone`,
    )
  }
  const clampedFrom = Math.max(from, oldest)
  const clampedTo = Math.min(to, now)
  return {
    from: clampedFrom,
    to: clampedTo,
    seconds: clampedTo - clampedFrom,
    partial: clampedFrom !== from || clampedTo !== to,
  }
}

export interface CountWindow {
  range: string
  at?: number
}

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3600,
  d: DAY_SECONDS,
  w: 7 * DAY_SECONDS,
}

export function rangeSeconds(range: string): number {
  const match = /^(\d+)([smhdw])$/.exec(range)
  if (!match)
    throw new Error(`"${range}" is not a single-unit PromQL duration such as 7d or 86400s`)
  return Number(match[1]) * UNIT_SECONDS[match[2]]
}

export const windowAt = (w: Pick<ClampedWindow, "seconds" | "to">): CountWindow => ({
  range: `${w.seconds}s`,
  at: w.to,
})

export const daysOf = (seconds: number) => Math.round((seconds / DAY_SECONDS) * 100) / 100

export const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString()
