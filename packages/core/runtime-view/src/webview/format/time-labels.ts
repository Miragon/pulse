import { formatClock, formatInstant, formatRelativeTime } from "@miragon/pulse-ui/format"
import { LabelLocale } from "./label-locale.js"

export class TimeLabels {
  static {
    LabelLocale.apply()
  }

  static clock(iso: string, now: Date = new Date()): string {
    return formatClock(iso, { seconds: false, now })
  }

  static asOf(iso: string, now: Date = new Date()): string {
    return formatClock(iso, { now })
  }

  static precise(iso: string, now: Date = new Date()): string {
    return formatClock(iso, { milliseconds: true, now })
  }

  static relative(iso: string, now: Date = new Date()): string {
    return formatRelativeTime(iso, now)
  }

  static tooltip(iso: string): string {
    return formatInstant(iso)
  }
}
