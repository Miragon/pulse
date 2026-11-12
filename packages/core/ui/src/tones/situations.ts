import type { ToneVariant } from "./tone-variant.js"

/**
 * The situations a person meets on a process engine, each with the ONE tone it shows in every
 * Pulse UI: the MCP widgets read it at runtime, the VS Code webview's state labels read it and
 * its tests hold the diagram badges to it. Same situation, same colour; a new UI looks its tone
 * up here instead of choosing one.
 *
 * It tones a situation where a UI shows it as a state: a label, a badge, a dot, a count pill. A
 * drawing that is no state stays outside it, as the VS Code diagram's green path (the elements an
 * instance passed and the flows it took, its legend says so) and the strip a notice sits in.
 *
 * The ladder: what waits for a person is `danger`; what can still recover on its own is
 * `warning`; a running instance or element shown as its state is `info`; everything else,
 * including a process that runs without a problem, is `neutral` (never a green "healthy": green
 * would claim "done well" over something nobody looked at). A count of a situation is a figure
 * and stays neutral beside the tone (`countTone` tones a count of problems only).
 */
export const SITUATION_TONES = {
  /** An open incident on the thing shown: an instance, an element, a process. */
  openIncident: "danger",
  /** An open incident in an instance the thing shown called (a call activity's child). */
  incidentInCalledInstance: "danger",
  /** A failed job without retries: nothing runs it again until a person does. */
  jobWithoutRetries: "danger",
  /** A failed job with retries left: the engine runs it again on its own. */
  jobWithRetriesLeft: "warning",
  /** A running instance or element, shown as its state (a state label, a diagram badge). */
  running: "info",
  /** A suspended instance: it waits on purpose until a person activates it; nothing is wrong. */
  suspended: "neutral",
  /** An instance or a step that ended: completed, cancelled or terminated. */
  ended: "neutral",
  /**
   * A process with running instances and no open incident or job without retries, and an engine
   * whose verdict is ok.
   */
  healthy: "neutral",
  /** A process nothing runs on (an idle deployment). */
  idle: "neutral",
} as const satisfies Record<string, ToneVariant>

/** A situation {@link SITUATION_TONES} gives a tone. */
export type Situation = keyof typeof SITUATION_TONES
