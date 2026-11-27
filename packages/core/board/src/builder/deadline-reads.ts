import { RuntimeError } from "@miragon/pulse-engine-core"
import type { BoardReads, EngineSource } from "./board-reads.js"

interface Timers {
  setTimeout(task: () => void, delayMs: number): unknown
  clearTimeout(timer: unknown): void
}

export class DeadlineReads {
  private static readonly LONGEST_MS = 2_147_483_647

  private passed = false
  private timer: unknown
  private readonly expiry: Promise<void>

  constructor(private readonly delayMs: number) {
    DeadlineReads.check(delayMs)
    this.expiry = new Promise((resolve) => {
      if (delayMs === Infinity) {
        return
      }
      this.timer = DeadlineReads.timers().setTimeout(() => {
        this.passed = true
        resolve()
      }, delayMs)
    })
  }

  of(engine: EngineSource): EngineSource {
    const reads = engine.reads
    if (reads === undefined) {
      return engine
    }
    return { name: engine.name, reads: this.over(engine.name, reads) }
  }

  end(): void {
    DeadlineReads.timers().clearTimeout(this.timer)
  }

  private over(name: string, reads: BoardReads): BoardReads {
    const held = <Value>(read: () => Promise<Value>) => this.held(name, read)
    return {
      describeEngine: () => held(() => reads.describeEngine()),
      listDefinitions: () => held(() => reads.listDefinitions()),
      countInstances: (filter) => held(() => reads.countInstances(filter)),
      searchInstances: (filter, page) => held(() => reads.searchInstances(filter, page)),
      getDiagramXml: (definitionId) => held(() => reads.getDiagramXml(definitionId)),
      getElementStatistics: (definitionId) => held(() => reads.getElementStatistics(definitionId)),
      searchIncidents: (filter, page) => held(() => reads.searchIncidents(filter, page)),
    }
  }

  private held<Value>(name: string, read: () => Promise<Value>): Promise<Awaited<Value>> {
    if (this.passed) {
      return Promise.reject(this.missed(name))
    }
    return Promise.race([read(), this.expiry.then(() => Promise.reject(this.missed(name)))])
  }

  private missed(name: string): RuntimeError {
    return new RuntimeError(
      "unreachable",
      `${name} did not answer the board's reads within ${this.delayMs} ms.`,
    )
  }

  private static check(delayMs: number): void {
    if (delayMs === Infinity || (delayMs >= 1 && delayMs <= DeadlineReads.LONGEST_MS)) {
      return
    }
    throw new RangeError(
      `engineDeadlineMs must be from 1 to ${DeadlineReads.LONGEST_MS} ms, or Infinity for no deadline, not ${delayMs}.`,
    )
  }

  private static timers(): Timers {
    return globalThis as typeof globalThis & Timers
  }
}
