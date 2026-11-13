import { formatCount, formatDuration, setFormatLocale, shortId } from "@miragon/pulse-ui/format"
import type { InstanceState, WaitStateKind } from "@miragon/pulse-engine-core"
import type { InstanceStateLabel } from "../protocol/index.js"

const ENGLISH_24_HOURS = { language: "en", locale: "en-u-hc-h23" }

const STATE_LABELS: Readonly<Record<InstanceState, InstanceStateLabel>> = {
  running: "Running",
  suspended: "Suspended",
  completed: "Completed",
  terminated: "Terminated",
}

const WAIT_KIND_LABELS: Readonly<Record<WaitStateKind, string>> = {
  userTask: "User task",
  workerTask: "Worker task",
  asyncContinuation: "Async continuation",
  timer: "Timer",
  message: "Message",
  signal: "Signal",
  other: "Waiting",
}

export class Labels {
  static {
    setFormatLocale(ENGLISH_24_HOURS)
  }

  static shortId(id: string): string {
    return shortId(id)
  }

  static instanceState(state: InstanceState): InstanceStateLabel {
    return STATE_LABELS[state]
  }

  static waitKind(kind: WaitStateKind): string {
    return WAIT_KIND_LABELS[kind]
  }

  static humanize(engineType: string): string {
    const words = engineType
      .replace(/[_-]+/g, " ")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .trim()
      .toLowerCase()
    return words.charAt(0).toUpperCase() + words.slice(1)
  }

  static duration(milliseconds: number): string {
    return formatDuration(Math.max(0, milliseconds))
  }

  static capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  static count(count: number): string {
    return formatCount(count)
  }

  static plural(count: number, noun: string, nouns = `${noun}s`): string {
    return `${Labels.count(count)} ${count === 1 ? noun : nouns}`
  }
}
