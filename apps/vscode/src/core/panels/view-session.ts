import type { LiveUpdates, PanelState, PanelView, Problem } from "../protocol/index.js"
import { LiveFailures } from "../refresh/live-failures.js"
import type { SettledRead, TickOutcome } from "../refresh/refresh-loop.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"

export interface Snapshot<View extends PanelView> {
  readonly view: View
}

export interface Unavailable {
  readonly problem: Problem
}

export interface SessionHooks<View extends PanelView> {
  readonly decorate?: (view: View) => View
  readonly live?: () => LiveUpdates | undefined
  readonly settled?: (read: SettledRead) => void
}

interface Failed extends Unavailable {
  readonly stops: boolean
}

export class ViewSession<View extends PanelView, Loaded extends Snapshot<View>> {
  private loaded: Loaded | undefined
  private problem: Problem | undefined
  private latest = 0
  private reloading = false
  private extending = false
  private closed = false

  constructor(
    private readonly context: PanelContext,
    private readonly loadingTitle: string,
    private readonly hooks: SessionHooks<View> = {},
  ) {}

  current(): Loaded | undefined {
    return this.loaded
  }

  close(): void {
    this.closed = true
  }

  republish(): void {
    if (this.loaded === undefined) {
      return
    }
    if (this.problem !== undefined) {
      this.publishFailure(this.problem)
      return
    }
    this.publishReady(this.loaded, this.reloading)
  }

  rebuild(build: (loaded: Loaded) => Loaded): void {
    if (this.loaded !== undefined) {
      this.loaded = build(this.loaded)
      this.republish()
    }
  }

  async resume(build: () => Promise<Loaded | Unavailable>): Promise<void> {
    if (this.loaded === undefined) {
      await this.reload(build)
      return
    }
    this.publishReady(this.loaded, false)
  }

  async reload(build: () => Promise<Loaded | Unavailable>): Promise<void> {
    const ticket = this.begin()
    const startedAt = this.context.now()
    this.reloading = true
    this.publishProgress()
    const outcome = await this.attempt(build)
    if (ticket !== this.latest) {
      return
    }
    this.reloading = false
    this.hooks.settled?.({ startedAt, succeeded: !this.isUnavailable(outcome) })
    this.settle(outcome)
  }

  async extend(build: (loaded: Loaded) => Promise<Loaded>): Promise<void> {
    const base = this.loaded
    if (base === undefined || this.busy()) {
      return
    }
    const ticket = this.begin()
    this.extending = true
    const outcome = await this.attempt(() => build(base))
    this.extending = false
    if (ticket === this.latest) {
      this.settle(outcome)
    }
  }

  async refreshQuietly(
    build: (loaded: Loaded) => Promise<Loaded | Unavailable>,
    load: () => Promise<Loaded | Unavailable>,
  ): Promise<TickOutcome> {
    if (this.busy()) {
      return "skipped"
    }
    const base = this.loaded
    const ticket = this.begin()
    const outcome = await this.attempt(() => (base === undefined ? load() : build(base)))
    if (ticket !== this.latest) {
      return "skipped"
    }
    if (this.isUnavailable(outcome) && this.isTransient(outcome)) {
      if (base === undefined) {
        this.settle(outcome)
      }
      return "failed"
    }
    this.settle(outcome)
    return this.isUnavailable(outcome) ? "stopped" : "done"
  }

  private busy(): boolean {
    return this.reloading || this.extending
  }

  private begin(): number {
    this.latest += 1
    return this.latest
  }

  private async attempt(build: () => Promise<Loaded | Unavailable>): Promise<Loaded | Unavailable> {
    try {
      const outcome = await build()
      this.context.live?.lane.unblock()
      return outcome
    } catch (error) {
      return this.failed(error)
    }
  }

  private failed(error: unknown): Failed {
    const stops = LiveFailures.stopsLiveUpdates(error)
    const problem = Problems.of(error, this.context.engine)
    if (stops) {
      this.context.live?.lane.block()
    }
    this.context.live?.log(`read failed${stops ? ", engine blocked" : ""}: ${problem.title}`)
    return { problem, stops }
  }

  private isTransient(outcome: Unavailable | Failed): boolean {
    return "stops" in outcome && !outcome.stops
  }

  private settle(outcome: Loaded | Unavailable): void {
    if (this.isUnavailable(outcome)) {
      this.problem = outcome.problem
      this.publishFailure(outcome.problem)
      return
    }
    this.problem = undefined
    this.loaded = outcome
    this.publishReady(outcome, false)
  }

  private isUnavailable(outcome: Loaded | Unavailable): outcome is Unavailable {
    return "problem" in outcome
  }

  private publish(state: PanelState): void {
    if (!this.closed) {
      this.context.publish(state)
    }
  }

  private publishProgress(): void {
    if (this.loaded === undefined) {
      this.publish({
        status: "loading",
        title: this.loadingTitle,
        engine: this.context.engine,
      })
      return
    }
    this.publishReady(this.loaded, true)
  }

  private publishReady(loaded: Loaded, refreshing: boolean): void {
    this.publish({
      status: "ready",
      view: this.decorated(loaded.view),
      refreshing,
      ...this.liveField(),
    })
  }

  private publishFailure(problem: Problem): void {
    this.publish({
      status: "failed",
      problem,
      engine: this.context.engine,
      ...(this.loaded === undefined ? {} : { staleView: this.decorated(this.loaded.view) }),
      ...this.liveField(),
    })
  }

  private decorated(view: View): View {
    return this.hooks.decorate === undefined ? view : this.hooks.decorate(view)
  }

  private liveField(): { readonly live?: LiveUpdates } {
    const live = this.hooks.live?.()
    return live === undefined ? {} : { live }
  }
}
