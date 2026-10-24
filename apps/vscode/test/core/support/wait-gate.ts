export class WaitGate {
  readonly delays: number[] = [];
  private readonly waiting: (() => void)[] = [];

  readonly wait = (milliseconds: number): Promise<void> => {
    this.delays.push(milliseconds);
    return new Promise((resolve) => this.waiting.push(resolve));
  };

  get pending(): number {
    return this.waiting.length;
  }

  async open(): Promise<void> {
    this.waiting.shift()?.();
    await WaitGate.settle();
  }

  static async settle(): Promise<void> {
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }
  }
}
