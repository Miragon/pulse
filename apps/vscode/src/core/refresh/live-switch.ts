export type LiveSetting = 'on' | 'off';

export class LiveSwitch {
  private readonly listeners = new Set<() => void>();

  constructor(private current: LiveSetting) {}

  get setting(): LiveSetting {
    return this.current;
  }

  set(next: LiveSetting): void {
    if (next === this.current) {
      return;
    }
    this.current = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
