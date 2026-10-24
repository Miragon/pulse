import type { BulkWording } from "../panels/bulk-action.js"
import type { BulkRun } from "../panels/bulk-run.js"
import type { BulkStatus, BulkView, Environment, Notice, NoticeAction } from "../protocol/index.js"
import { Labels } from "./labels.js"

const STALLED_AFTER_MS: Readonly<Record<Environment, number>> = {
  local: 2 * 60_000,
  test: 5 * 60_000,
  production: 5 * 60_000,
  unclassified: 5 * 60_000,
}
const DISMISS: NoticeAction = { kind: "dismissBulk", label: "Dismiss" }
const STOP: NoticeAction = { kind: "stopBulk", label: "Stop" }
const REMOVE: NoticeAction = { kind: "stopBulk", label: "Remove batch" }
const SHOW_WHY: NoticeAction = { kind: "showBulkFailures", label: "Show why" }

export interface BulkScene {
  readonly now: number
  readonly environment: Environment
  readonly shownVersion: number
  readonly canWrite: boolean
  readonly selectsRemaining?: false
}

export class BulkOutcomes {
  constructor(
    private readonly run: BulkRun,
    private readonly scene: BulkScene,
  ) {}

  view(): BulkView {
    const [status, notice] = this.statusAndNotice()
    return { status, notice, progress: this.run.progress, announcement: notice.title }
  }

  private statusAndNotice(): readonly [BulkStatus, Notice] {
    switch (this.run.phase) {
      case "submitting":
        return ["submitting", this.info(`${this.doing(true)}…`, undefined, [])]
      case "running":
        return this.isStalled() ? ["stalled", this.stalled()] : ["running", this.running()]
      case "stopping":
      case "settling":
        return [
          "stopping",
          this.info(`Stopping… ${this.doneSoFar()} so far`, this.unreadNote(), []),
        ]
      case "stopped":
        return ["stopped", this.stopped()]
      case "finished":
        return ["finished", this.finished()]
      case "failed":
        return ["failed", this.failed()]
      case "unknown":
        return ["unknown", this.unknown()]
    }
  }

  private running(): Notice {
    const { done, failed, total } = this.run.progress
    const title = `${this.doing(false)}: ${done} of ${total} done`
    const unread = this.unreadNote()
    if (unread !== undefined) {
      return { tone: "warning", title, detail: unread, actions: this.stopAction() }
    }
    const detail = this.run.message ?? (failed > 0 ? `${failed} failed` : undefined)
    return this.info(title, detail, this.stopAction())
  }

  private stalled(): Notice {
    const { done, total } = this.run.progress
    const idle = Labels.duration(this.scene.now - this.run.lastChangeAt)
    return {
      tone: "warning",
      title: `No progress for ${idle}: ${done} of ${total} done`,
      detail: this.wording().stalled,
      actions: this.stopAction(),
    }
  }

  private stopped(): Notice {
    const left = this.run.remaining ?? 0
    const { total } = this.run.progress
    const halted = this.run.halted
    return {
      tone: "warning",
      title: `Stopped. ${this.doneCount()} of ${total} ${this.wording().done}, ${left} still ${this.wording().eligible}.`,
      detail:
        this.run.message ??
        (halted
          ? "The engine keeps the halted operation. Stop again to remove it."
          : "Stopping doesn't undo what is already done."),
      actions: [
        ...this.stopAction(),
        ...this.whyAction(),
        ...this.remainingAction(left),
        ...(this.run.lingers ? [] : [DISMISS]),
      ],
    }
  }

  private finished(): Notice {
    const left = this.run.remaining ?? 0
    const { total } = this.run.progress
    const done = Labels.capitalized(this.wording().done)
    const arrival = this.wording().arrival ?? ""
    if (left > 0) {
      return {
        tone: "danger",
        title: `${done} ${this.doneCount()} of ${total}${arrival}. ${left} still ${this.wording().eligible}.`,
        detail:
          this.sentences([this.run.message ?? this.wording().notDone, ...this.asides()]) ??
          this.wording().notDone,
        actions: [...this.whyAction(), ...this.remainingAction(left), ...this.removeOrDismiss()],
      }
    }
    return this.info(
      `${done} ${Labels.plural(this.doneCount(), "instance")}${this.versionNote()}${arrival}.`,
      this.sentences([...this.asides(), ...this.skippedNote()]),
      [...this.whyAction(), ...this.removeOrDismiss()],
    )
  }

  private failed(): Notice {
    return {
      tone: "danger",
      title: `Could not start ${this.wording().doing.toLowerCase()}${this.versionNote()}.`,
      ...(this.run.message === undefined ? {} : { detail: this.run.message }),
      actions: [DISMISS],
    }
  }

  private unknown(): Notice {
    const left = this.run.remaining
    const { total } = this.run.progress
    return {
      tone: "warning",
      title: `Unknown whether ${this.wording().doing.toLowerCase()} started${this.versionNote()}.`,
      detail:
        left === undefined
          ? `${this.run.message ?? "The engine did not answer."} Check the instances before you try again.`
          : `${left} of ${total} still ${this.wording().eligible}.`,
      actions: [{ kind: "checkBulk", label: "Check instances" }, DISMISS],
    }
  }

  private unreadNote(): string | undefined {
    const unread = this.run.readProblem
    return unread === undefined ? undefined : `Pulse can't read its progress: ${unread}`
  }

  private skippedNote(): string[] {
    const skipped = this.run.plan.skipped
    if (skipped === 0) {
      return []
    }
    const verb = skipped === 1 ? "was" : "were"
    return [
      `${Labels.plural(skipped, "instance")} ${this.wording().skipped} and ${verb} left alone.`,
    ]
  }

  private asides(): string[] {
    const leftOut = this.run.plan.leftOut ?? 0
    const ended = this.endedMeanwhile()
    return [
      ...(leftOut === 0 ? [] : [`${leftOut} left out, still ${this.wording().eligible}.`]),
      ...(ended === 0 ? [] : [`${ended} ended meanwhile.`]),
      ...(this.run.lingers
        ? [
            `The engine keeps the batch with ${Labels.plural(this.run.progress.failed, "failed item")}.`,
          ]
        : []),
    ]
  }

  private endedMeanwhile(): number {
    const { arrived, remaining } = this.run
    return arrived === undefined
      ? 0
      : Math.max(0, this.run.progress.total - arrived - (remaining ?? 0))
  }

  private doneCount(): number {
    const { total } = this.run.progress
    return this.run.arrived ?? total - (this.run.remaining ?? 0)
  }

  private sentences(parts: readonly string[]): string | undefined {
    return parts.length === 0 ? undefined : parts.join(" ")
  }

  private whyAction(): NoticeAction[] {
    return (this.run.failures?.length ?? 0) > 0 ? [SHOW_WHY] : []
  }

  private removeOrDismiss(): NoticeAction[] {
    return this.run.lingers && this.scene.canWrite && this.run.stopTarget() !== undefined
      ? [REMOVE]
      : [DISMISS]
  }

  private info(title: string, detail: string | undefined, actions: NoticeAction[]): Notice {
    return { tone: "info", title, ...(detail === undefined ? {} : { detail }), actions }
  }

  private stopAction(): NoticeAction[] {
    return this.run.stopTarget() !== undefined && this.scene.canWrite ? [STOP] : []
  }

  private remainingAction(left: number): NoticeAction[] {
    const shown = this.run.plan.version === this.scene.shownVersion
    if (left === 0 || !shown || !this.scene.canWrite || this.scene.selectsRemaining === false) {
      return []
    }
    const which = left === 1 ? "one" : String(left)
    return [
      { kind: "selectRemaining", label: `Select the ${which} still ${this.wording().eligible}` },
    ]
  }

  private isStalled(): boolean {
    const idle = this.scene.now - this.run.lastChangeAt
    return this.run.readProblem === undefined && idle >= STALLED_AFTER_MS[this.scene.environment]
  }

  private doing(counted: boolean): string {
    const what = counted ? Labels.plural(this.run.progress.total, "instance") : "instances"
    return `${this.wording().doing} ${what}${this.versionNote()}`
  }

  private doneSoFar(): string {
    const { done, total } = this.run.progress
    return `${done} of ${total} ${this.wording().done}`
  }

  private versionNote(): string {
    const { version } = this.run.plan
    return version === this.scene.shownVersion ? "" : ` of v${version}`
  }

  private wording(): BulkWording {
    return this.run.plan.action.wording
  }
}
