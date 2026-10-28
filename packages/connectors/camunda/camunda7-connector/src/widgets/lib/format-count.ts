import { formatNumber } from "@miragon/pulse-widget-shell/widgets"

/** `null` is a number the server could not vouch for: "—", never a `0` that reads as fact. */
export function formatCount(value: number | null | undefined): string {
  return formatNumber(value)
}

/** A capped scan's share is a lower bound ("≥2,000"), never the total. */
export function formatCountAtLeast(exact: number | null, scanned: number): string {
  return exact === null ? `≥${formatNumber(scanned)}` : formatNumber(exact)
}
