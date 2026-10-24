import type { Attention } from "../refresh/live-context.js"
import { LiveFailures } from "../refresh/live-failures.js"
import { BulkFailures } from "./bulk-failures.js"
import type { BulkRun } from "./bulk-run.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"

const FIRST_POLLS_MS = [2000, 3000, 5000] as const
const STEADY_POLL_MS = 10_000
const LOGIN_PAUSED = "Paused until the engine accepts the login again."

export interface FollowHost {
  reload(): Promise<void>
  republish(): void
}

export class BulkFollow {
  private watched = true
  private returning = false
  private closed = false
  private generation = 0
  private following: BulkRun | undefined

  constructor(
    private readonly context: PanelContext,
    private readonly host: FollowHost,
  ) {}

  follow(run: BulkRun): void {
    if (this.closed || !this.watched || !run.isActive()) {
      return
    }
    const retry = (): void => {
      this.follow(run)
    }
    if (!run.claim(this, retry)) {
      return
    }
    if (this.returning) {
      run.watchedAgain(this.context.now())
      this.returning = false
    }
    this.generation += 1
    this.following = run
    void this.loop(run, this.generation)
  }

  async check(run: BulkRun): Promise<void> {
    try {
      await this.inLane(() => this.reconcile(run))
      await this.host.reload()
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine))
    }
  }

  attend(attention: Attention): void {
    const watched = attention === "watched"
    if (this.watched && !watched) {
      this.letGo()
    }
    this.returning = this.returning || (!this.watched && watched)
    this.watched = watched
  }

  dispose(): void {
    this.closed = true
    this.letGo()
  }

  private async loop(run: BulkRun, generation: number): Promise<void> {
    for (let poll = 0; this.owns(run, generation); poll += 1) {
      await this.context.wait(FIRST_POLLS_MS[poll] ?? STEADY_POLL_MS)
      if (!this.owns(run, generation)) {
        return
      }
      await this.poll(run)
    }
    if (this.generation === generation) {
      this.letGo()
    }
  }

  private owns(run: BulkRun, generation: number): boolean {
    return !this.closed && this.generation === generation && run.isActive()
  }

  private letGo(): void {
    this.generation += 1
    this.following?.release(this)
    this.following = undefined
  }

  private async poll(run: BulkRun): Promise<void> {
    try {
      if (await this.inLane(() => this.read(run))) {
        await this.host.reload()
        this.reportOutcome(run)
      }
    } catch (error) {
      if (LiveFailures.stopsLiveUpdates(error)) {
        this.context.live?.lane.block()
      }
      run.readFailed(Problems.of(error, this.context.engine).title)
    }
    this.host.republish()
  }

  private async read(run: BulkRun): Promise<boolean> {
    if (this.context.live?.lane.isBlocked === true) {
      run.readFailed(LOGIN_PAUSED)
      return false
    }
    const operationId = run.operationId
    if (run.phase !== "settling" && operationId !== undefined) {
      const operation = await this.context.runtime.getBulkOperation(operationId)
      if (!run.observed(operation, this.context.now())) {
        return false
      }
      await BulkFailures.note(this.context, run).catch(() => undefined)
    }
    await this.reconcile(run)
    return true
  }

  private async reconcile(run: BulkRun): Promise<void> {
    const { action, ids } = run.plan
    const arrivedFilter = action.arrivedFilter?.({ instanceIds: ids })
    const [remaining, arrived] = await Promise.all([
      this.context.runtime.countInstances(action.eligibleFilter({ instanceIds: ids })),
      arrivedFilter === undefined ? undefined : this.context.runtime.countInstances(arrivedFilter),
    ])
    run.reconciled(remaining, arrived)
  }

  private reportOutcome(run: BulkRun): void {
    const { phase, operationId, remaining } = run
    if ((phase !== "finished" && phase !== "stopped") || operationId === undefined) {
      return
    }
    const { arrived } = run
    this.context.effects.reportBulkOutcome({
      action: run.plan.action.kind,
      operationId,
      phase,
      total: run.progress.total,
      remaining: remaining ?? 0,
      failed: run.progress.failed,
      ...(arrived === undefined ? {} : { arrived }),
    })
  }

  private inLane<Result>(task: () => Promise<Result>): Promise<Result> {
    const lane = this.context.live?.lane
    return lane === undefined ? task() : lane.run(task)
  }
}
