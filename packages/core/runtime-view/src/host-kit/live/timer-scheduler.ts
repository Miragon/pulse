import type { Cancel, Scheduler } from "../../core/index.js"

export class TimerScheduler implements Scheduler {
  schedule(delayMs: number, task: () => void): Cancel {
    const timer = setTimeout(task, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }
}
