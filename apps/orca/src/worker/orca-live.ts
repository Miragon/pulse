import type { Attention, LiveContext } from "@miragon/pulse-runtime-view/core"
import { type Connection, TimerScheduler } from "@miragon/pulse-runtime-view/host-kit"

const IDLE_AFTER_MS = 15 * 60_000

type Listener = () => void

export class OrcaLive {
  private readonly scheduler = new TimerScheduler()
  private readonly listeners = new Set<Listener>()
  private idle = false
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly log: (line: string) => void) {
    this.noteActivity()
  }

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

  of(visible: boolean): Attention {
    if (!visible) {
      return "hidden"
    }
    return this.idle ? "idle" : "watched"
  }

  noteActivity(): void {
    const wasIdle = this.idle
    this.idle = false
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idle = true
      this.fire()
    }, IDLE_AFTER_MS)
    if (wasIdle) {
      this.fire()
    }
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer)
  }

  private fire(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}
