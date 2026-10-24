import type { InstanceDetail } from '../../contract/index.js';

export class ActiveTokens {
  private readonly waiting = new Map<string, number>();
  private readonly running = new Map<string, number>();

  constructor(detail: InstanceDetail) {
    for (const waitState of detail.waitStates) {
      if (
        waitState.instanceId === detail.instance.id &&
        waitState.attachedToElementId === undefined
      ) {
        ActiveTokens.count(this.waiting, waitState.elementId);
      }
    }
    for (const run of detail.path.filter((candidate) => candidate.endedAt === undefined)) {
      ActiveTokens.count(this.running, run.elementId);
    }
  }

  at(elementId: string): number {
    return Math.max(this.waiting.get(elementId) ?? 0, this.running.get(elementId) ?? 0);
  }

  runsOf(elementId: string): number {
    return this.running.get(elementId) ?? 0;
  }

  holders(): string[] {
    return [...new Set([...this.waiting.keys(), ...this.running.keys()])];
  }

  private static count(counts: Map<string, number>, elementId: string): void {
    counts.set(elementId, (counts.get(elementId) ?? 0) + 1);
  }
}
