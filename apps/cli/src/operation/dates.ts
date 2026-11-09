/**
 * Normalizes date-time input to the engine format `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with an RFC 822
 * offset, e.g. `2024-05-01T10:00:00.000+0200`, through c7-core's parser in its
 * `UTC_WITHOUT_OFFSET` reading. Pure.
 *
 *   2024-05-01                          → 2024-05-01T00:00:00.000+0000
 *   2024-05-01T10:00 / ...T10:00:00     → treated as UTC (+0000)
 *   ...T10:00:00.5Z / +02:00 / +0200    → fraction padded or truncated to 3 digits, offset kept
 */

import { engineDateInput, UTC_WITHOUT_OFFSET } from "@miragon/pulse-c7-core"
import { usageError } from "../errors.js"

export const DATE_TIME_HINT =
  "Accepted forms: 2024-05-01, 2024-05-01T10:00, 2024-05-01T10:00:00, 2024-05-01T10:00:00Z, " +
  "2024-05-01T10:00:00.000+02:00 and the engine format 2024-05-01T10:00:00.000+0200. " +
  "Times without an offset are UTC."

/** Normalizes to the engine format; throws a usage error listing the accepted forms. */
export function normalizeDateTime(raw: string): string {
  const normalized = engineDateInput(raw, UTC_WITHOUT_OFFSET)
  if (normalized === undefined) throw usageError(`Invalid date-time "${raw}"`, DATE_TIME_HINT)
  return normalized
}
