/**
 * The cause the family shows for a failure: the root cause of its text (a job's stack trace, an
 * external task's error details) by the engine contract's rule, `RootCauses.of`, the one rule of
 * every dialect. The CLI's job outcomes and the inspect view both name it this way.
 */

import { RootCauses } from "@miragon/pulse-engine-contract"

/**
 * The root cause of `text`, or `fallback` (the incident or engine message) when there is no text
 * or no line in it.
 */
export function causeOf<Fallback extends string | undefined>(
  text: string | undefined,
  fallback: Fallback,
): string | Fallback {
  return (text === undefined ? undefined : RootCauses.of(text)) ?? fallback
}
