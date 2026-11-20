import { VariableDraft } from "@miragon/pulse-blocks"

/**
 * A date of a variable condition both ways: the condition dialog writes this browser's wall clock
 * (`YYYY-MM-DDTHH:mm`, seconds optional, the blocks' `VariableDraft.DATE_PATTERN`), while the
 * address and the list feed carry the instant it names here, with its offset, so a link shared
 * into another time zone lists the same instances; the reader sees the instant on their own clock.
 */

/** A wall clock without a zone, as the dialog writes it. */
const WALL_CLOCK = new RegExp(`^${VariableDraft.DATE_PATTERN}$`)

/** An instant with its offset, as the address carries it (`Z` or `±hh:mm`). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** Two digits of a part of a date. */
const two = (part: number): string => String(part).padStart(2, "0")

/** The instant a wall clock names in this browser's zone; any other value as it is. */
export function instantOf(value: string): string {
  if (!WALL_CLOCK.test(value)) return value
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? value : at.toISOString()
}

/** An instant on this browser's wall clock, its seconds only where it has some; any other value as it is. */
export function wallClockOf(value: string): string {
  if (!INSTANT.test(value)) return value
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const day = `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`
  const seconds = at.getSeconds()
  return `${day}T${time}${seconds === 0 ? "" : `:${two(seconds)}`}`
}
