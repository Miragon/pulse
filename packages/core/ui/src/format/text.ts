import { EMPTY } from "./locale.js"

export function truncate(value: string | null | undefined, max: number): string {
  if (!value) return EMPTY
  return value.length > max ? value.slice(0, max) + "…" : value
}

const ID_FULL_LENGTH = 12
const ID_SHORT_LENGTH = 8
const DIGITS = /^\d+$/
const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

/**
 * An id short enough to scan: up to 12 characters whole, a longer number by its tail
 * (`…13685249`: big-integer keys of one engine share their head), a UUID by its head
 * (`5f0ce78e…`), any other id whole (only those two have a part that is safe to drop). Show the
 * full id beside it (a title, a copy button).
 */
export function shortId(id: string): string {
  if (id.length <= ID_FULL_LENGTH) return id
  if (DIGITS.test(id)) return `…${id.slice(-ID_SHORT_LENGTH)}`
  return UUID_HEAD.test(id) ? `${id.slice(0, ID_SHORT_LENGTH)}…` : id
}
