import type { LiveContext } from "../../core/index.js"
import type { Connection } from "../connections/connection.js"
import { TimerScheduler } from "./timer-scheduler.js"
import type { WindowAttention } from "./window-attention.js"

export class LiveWiring {
  private readonly scheduler = new TimerScheduler()

  constructor(
    readonly attention: WindowAttention,
    private readonly log: (line: string) => void,
  ) {}

  contextFor(connection: Connection): LiveContext {
    return {
      switch: connection.live,
      scheduler: this.scheduler,
      lane: connection.lane,
      random: Math.random,
      log: (line) => {
        this.log(`${connection.target.name}: ${line}`)
      },
    }
  }
}
