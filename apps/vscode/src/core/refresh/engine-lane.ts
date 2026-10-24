export class EngineLane {
  private busy = false;
  private blocked = false;
  private readonly waiting: (() => void)[] = [];

  get isBlocked(): boolean {
    return this.blocked;
  }

  block(): void {
    this.blocked = true;
  }

  unblock(): void {
    this.blocked = false;
  }

  async tryRun<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (this.busy || this.blocked) {
      return undefined;
    }
    return this.run(task);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.busy) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.busy = true;
    }
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) {
      this.busy = false;
    } else {
      next();
    }
  }
}
