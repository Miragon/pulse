import type { Cancel, Scheduler } from '../../../src/core/refresh/scheduler.js';

interface Planned {
  readonly at: number;
  readonly task: () => void;
}

export class ManualScheduler implements Scheduler {
  private planned: Planned[] = [];
  private elapsed = 0;

  constructor(private readonly startMs = 0) {}

  now(): Date {
    return new Date(this.startMs + this.elapsed);
  }

  get pending(): readonly number[] {
    return this.planned.map((entry) => entry.at - this.elapsed);
  }

  schedule(delayMs: number, task: () => void): Cancel {
    const entry: Planned = { at: this.elapsed + delayMs, task };
    this.planned.push(entry);
    return () => {
      this.planned = this.planned.filter((candidate) => candidate !== entry);
    };
  }

  async advance(milliseconds: number): Promise<void> {
    const until = this.elapsed + milliseconds;
    for (;;) {
      const due = this.planned
        .filter((entry) => entry.at <= until)
        .sort((left, right) => left.at - right.at)[0];
      if (due === undefined) {
        break;
      }
      this.planned = this.planned.filter((candidate) => candidate !== due);
      this.elapsed = due.at;
      due.task();
      await this.settle();
    }
    this.elapsed = Math.max(this.elapsed, until);
    await this.settle();
  }

  advanceClock(milliseconds: number): Promise<void> {
    this.elapsed += milliseconds;
    return Promise.resolve();
  }

  async settle(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      await Promise.resolve();
    }
  }
}
