import type { DefinitionSummary, ProcessRuntime } from "../../contract/index.js"
import type { EngineLane } from "./engine-lane.js"
import { LiveFailures } from "./live-failures.js"

interface Reading {
  readonly summaries: Promise<readonly DefinitionSummary[]>
  settledAt: number | undefined
  stale: boolean
}

const REUSE_WITHIN_MS = 5000

export class SharedDefinitions {
  private latest: Reading | undefined
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly runtime: Pick<ProcessRuntime, "listDefinitions">,
    private readonly lane: EngineLane,
    private readonly now: () => number = Date.now,
  ) {}

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.read(REUSE_WITHIN_MS)
  }

  read(maxAgeMs: number): Promise<readonly DefinitionSummary[]> {
    const latest = this.latest
    if (latest !== undefined && this.isFresh(latest, maxAgeMs)) {
      return latest.summaries
    }
    return this.fetch()
  }

  forget(): void {
    const latest = this.latest
    if (latest === undefined) {
      return
    }
    latest.stale = true
    if (latest.settledAt !== undefined) {
      this.notify()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private fetch(): Promise<readonly DefinitionSummary[]> {
    const reading: Reading = {
      summaries: this.runtime.listDefinitions(),
      settledAt: undefined,
      stale: false,
    }
    this.latest = reading
    reading.summaries.then(
      () => {
        reading.settledAt = this.now()
        this.lane.unblock()
        this.notify()
      },
      (error: unknown) => {
        reading.settledAt = this.now()
        if (LiveFailures.stopsLiveUpdates(error)) {
          this.lane.block()
        }
      },
    )
    return reading.summaries
  }

  private isFresh(reading: Reading, maxAgeMs: number): boolean {
    return (
      !reading.stale &&
      (reading.settledAt === undefined || this.now() - reading.settledAt < maxAgeMs)
    )
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}
