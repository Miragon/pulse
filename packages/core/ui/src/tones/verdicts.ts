import { SITUATION_TONES } from "./situations.js"
import type { ToneVariant } from "./tone-variant.js"

/**
 * An engine's own state, its one live verdict (`ok`, `warning` or `critical`, c7-core's
 * `engineVerdict`), as the ONE tone every Pulse UI that shows it reads: the chat's overview badge
 * and engine dots, the web app's engine screen and start page. An engine that runs without a
 * problem is the table's `healthy`, neutral as a process is, never a green "healthy"; a degraded
 * one `warning`; a critical one has an open incident's danger.
 */
export const VERDICT_TONES = {
  ok: SITUATION_TONES.healthy,
  warning: "warning",
  critical: SITUATION_TONES.openIncident,
} as const satisfies Record<string, ToneVariant>

/** A verdict {@link VERDICT_TONES} gives a tone. */
export type Verdict = keyof typeof VERDICT_TONES

/**
 * Why an engine's live state could not be read, which then shows no verdict, as a tone. These are
 * no situations on the engine but the server's way to it: an engine that does not answer may be
 * down, an outage, so danger; a refused profile or login leaves the engine running and waits only
 * for whoever runs the server to fix its configuration, a degraded engine, so warning.
 */
export const READ_FAILURE_TONES = {
  unreachable: "danger",
  refused: "warning",
  unauthorized: "warning",
  forbidden: "warning",
} as const satisfies Record<string, ToneVariant>

/** A failed read {@link READ_FAILURE_TONES} gives a tone. */
export type ReadFailure = keyof typeof READ_FAILURE_TONES
