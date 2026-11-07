import type { Environment, LiveUpdates, PauseReason } from "../../core/protocol/index.js"
import { TimeLabels } from "./time-labels.js"

export interface LiveControl {
  readonly intent: "pauseLiveUpdates" | "resumeLiveUpdates" | "turnOnLiveUpdates"
  readonly label: string
  readonly playing: boolean
}

const STALE_GRACE_MS = 10_000
const WHILE_SEEN = "while this tab is visible and the window has focus"

const PAUSE_NOTES: Readonly<Record<PauseReason, string>> = {
  user: "Live updates are paused for this tab. Resume reads the engine at once.",
  background: "Live updates are paused while this window is in the background.",
  idle: "Live updates are paused while VS Code is idle. They resume when you work in it again.",
  editing: "Live updates are paused while you edit a variable.",
}

const STOP_NOTES = {
  refused:
    "Live updates stopped because the engine refused the request. Set the credentials or reconnect to try again.",
  gone: "Live updates stopped because the engine no longer has this instance or version.",
} as const

const PAUSE: LiveControl = {
  intent: "pauseLiveUpdates",
  label: "Pause live updates",
  playing: true,
}
const RESUME: LiveControl = {
  intent: "resumeLiveUpdates",
  label: "Resume live updates",
  playing: false,
}

export class LiveLabels {
  static isStale(live: LiveUpdates | undefined, ageMs: number): boolean {
    return live?.status === "live" && ageMs > 2 * live.everySeconds * 1000 + STALE_GRACE_MS
  }

  static readTooltip(at: string, live: LiveUpdates | undefined): string {
    const read = `Read ${TimeLabels.tooltip(at)} (${TimeLabels.relative(at)}).`
    const note = LiveLabels.note(live)
    return note === "" ? read : `${read} ${note}`
  }

  static note(live: LiveUpdates | undefined): string {
    switch (live?.status) {
      case undefined:
        return ""
      case "live":
        return `Updates every ${live.everySeconds} s ${WHILE_SEEN}.`
      case "paused":
        return PAUSE_NOTES[live.reason]
      case "reconnecting":
        return `The last read failed. Pulse tries again at ${TimeLabels.asOf(live.retryAt)}.`
      case "ended":
        return "This instance has ended, so Pulse no longer reads it."
      case "stopped":
        return STOP_NOTES[live.reason]
      case "off":
        return LiveLabels.offNote(live.environment, live.everySeconds)
    }
  }

  static control(live: LiveUpdates | undefined): LiveControl | undefined {
    switch (live?.status) {
      case "live":
      case "reconnecting":
        return PAUSE
      case "paused":
        return live.reason === "user" ? RESUME : PAUSE
      case "off":
        return {
          intent: "turnOnLiveUpdates",
          label: `Turn on live updates for ${live.environment} engines`,
          playing: false,
        }
      default:
        return undefined
    }
  }

  private static offNote(environment: Environment, everySeconds: number): string {
    return `Live updates are off for ${environment} engines. The button turns them on in your user settings (pulse.liveUpdates); then this view reads the engine every ${everySeconds} s ${WHILE_SEEN}.`
  }
}
