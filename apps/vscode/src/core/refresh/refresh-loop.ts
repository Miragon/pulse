import type { Environment, LiveUpdates } from "../protocol/index.js"
import type { Attention, LiveContext } from "./live-context.js"
import { RefreshCadence, type LiveView } from "./refresh-cadence.js"
import type { Cancel } from "./scheduler.js"

export type TickOutcome = "done" | "failed" | "stopped" | "skipped"

export interface Refreshable {
  refreshQuietly(tick: number): Promise<TickOutcome>
  isBusy(): boolean
  hasEnded(): boolean
  showLive(): void
}

export interface LoopTiming {
  readonly view: LiveView
  readonly environment: Environment
  readonly now: () => Date
}

export interface SettledRead {
  readonly startedAt: Date
  readonly succeeded: boolean
}

export class RefreshLoop {
  private attention: Attention = "hidden"
  private pausedByUser = false
  private editing = false
  private gone = false
  private nudged = false
  private running = false
  private disposed = false
  private failures = 0
  private reads = 0
  private lastReadAt: number | undefined
  private lastLoadMs = 0
  private nextAt = 0
  private cancel: Cancel | undefined
  private readonly intervalMs: number
  private readonly unsubscribe: () => void

  constructor(
    private readonly live: LiveContext,
    private readonly target: Refreshable,
    private readonly timing: LoopTiming,
  ) {
    this.intervalMs = RefreshCadence.intervalMs(timing.view, timing.environment)
    this.unsubscribe = live.switch.subscribe(() => {
      this.plan(0)
      this.target.showLive()
    })
  }

  status(): LiveUpdates {
    if (this.live.switch.setting === "off") {
      return {
        status: "off",
        environment: this.timing.environment,
        everySeconds: RefreshCadence.seconds(this.intervalMs),
      }
    }
    if (this.target.hasEnded()) {
      return { status: "ended" }
    }
    if (this.gone || this.live.lane.isBlocked) {
      return { status: "stopped", reason: this.gone ? "gone" : "refused" }
    }
    return this.runningStatus()
  }

  attend(attention: Attention): void {
    if (attention === this.attention) {
      return
    }
    this.attention = attention
    if (attention === "hidden") {
      this.editing = false
    }
    this.log(`${this.ticking() ? "running" : "paused"} (${attention})`)
    this.plan()
    this.target.showLive()
  }

  pause(): void {
    this.pausedByUser = true
    this.log("paused by the user")
    this.plan()
    this.target.showLive()
  }

  resume(): void {
    this.pausedByUser = false
    this.log("resumed by the user")
    this.plan(0)
    this.target.showLive()
  }

  holdForEditor(held: boolean): void {
    this.editing = held
    this.plan()
    this.target.showLive()
  }

  nudge(): void {
    this.nudged = true
    this.plan(RefreshCadence.catchUpMs(this.live.random))
  }

  settled(read: SettledRead): void {
    this.lastLoadMs = this.elapsedSince(read.startedAt)
    if (read.succeeded) {
      this.gone = false
      this.failures = 0
      this.lastReadAt = read.startedAt.getTime()
    } else {
      this.failures += 1
    }
    this.plan()
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.plan()
  }

  private runningStatus(): LiveUpdates {
    if (this.pausedByUser) {
      return { status: "paused", reason: "user" }
    }
    if (this.editing) {
      return { status: "paused", reason: "editing" }
    }
    if (this.attention === "background" || this.attention === "idle") {
      return { status: "paused", reason: this.attention }
    }
    if (this.failures > 0) {
      return { status: "reconnecting", retryAt: new Date(this.nextAt).toISOString() }
    }
    return { status: "live", everySeconds: RefreshCadence.seconds(this.throttledMs()) }
  }

  private throttledMs(): number {
    return RefreshCadence.throttledMs(this.intervalMs, this.lastLoadMs)
  }

  private ticking(): boolean {
    return (
      !this.disposed &&
      this.live.switch.setting === "on" &&
      !this.gone &&
      !this.pausedByUser &&
      !this.editing &&
      this.attention === "watched" &&
      !this.target.hasEnded()
    )
  }

  private plan(delayMs?: number): void {
    this.cancel?.()
    this.cancel = undefined
    if (!this.ticking()) {
      return
    }
    const delay = delayMs ?? this.dueInMs()
    this.nextAt = this.timing.now().getTime() + delay
    this.cancel = this.live.scheduler.schedule(delay, () => {
      void this.tick()
    })
  }

  private dueInMs(): number {
    if (this.failures > 0) {
      const backoff = RefreshCadence.backoffMs(
        this.intervalMs,
        this.failures,
        this.timing.environment,
        this.live.random,
      )
      return Math.max(backoff, this.throttledMs())
    }
    const next = RefreshCadence.nextMs(this.intervalMs, this.lastLoadMs, this.live.random)
    if (this.lastReadAt === undefined) {
      return next
    }
    const age = this.timing.now().getTime() - this.lastReadAt
    return age >= this.throttledMs()
      ? RefreshCadence.catchUpMs(this.live.random)
      : Math.max(0, next - age)
  }

  private async tick(): Promise<void> {
    this.cancel = undefined
    if (!this.ticking() || this.running) {
      return
    }
    if (this.target.isBusy() || this.live.lane.isBlocked) {
      this.plan(this.intervalMs)
      this.target.showLive()
      return
    }
    this.running = true
    const startedAt = this.timing.now()
    const outcome =
      (await this.live.lane.tryRun(() => this.target.refreshQuietly(this.reads + 1))) ?? "skipped"
    this.running = false
    if (!this.disposed) {
      this.afterTick(outcome, startedAt)
    }
  }

  private afterTick(outcome: TickOutcome, startedAt: Date): void {
    if (outcome === "stopped" && !this.live.lane.isBlocked) {
      this.gone = true
      this.log("stopped: it is gone")
    }
    if (outcome === "done") {
      this.reads += 1
    }
    if (outcome === "done" || outcome === "failed") {
      this.nudged = false
      this.settled({ startedAt, succeeded: outcome === "done" })
    } else {
      this.plan(this.nudged ? RefreshCadence.catchUpMs(this.live.random) : undefined)
    }
    if (outcome === "failed") {
      const nextInSeconds = RefreshCadence.seconds(this.nextAt - this.timing.now().getTime())
      this.log(`failed ${this.failures} in a row, next try in ${nextInSeconds} s`)
    }
    this.target.showLive()
  }

  private log(event: string): void {
    this.live.log(`${this.timing.view} live updates ${event}`)
  }

  private elapsedSince(startedAt: Date): number {
    return Math.max(0, this.timing.now().getTime() - startedAt.getTime())
  }
}
