import type { BpmnProcessId } from '../../contract/index.js';
import type { BulkRun } from './bulk-run.js';

export class BulkRuns {
  private readonly runs = new Map<BpmnProcessId, BulkRun>();
  private readonly waiting = new Map<BpmnProcessId, Set<() => void>>();

  of(bpmnProcessId: BpmnProcessId): BulkRun | undefined {
    return this.runs.get(bpmnProcessId);
  }

  start(bpmnProcessId: BpmnProcessId, run: BulkRun): boolean {
    if (this.blocks(bpmnProcessId)) {
      return false;
    }
    this.runs.set(bpmnProcessId, run);
    const retries = [...(this.waiting.get(bpmnProcessId) ?? [])];
    this.waiting.delete(bpmnProcessId);
    for (const retry of retries) {
      retry();
    }
    return true;
  }

  whenStarted(bpmnProcessId: BpmnProcessId, retry: () => void): void {
    const waiting = this.waiting.get(bpmnProcessId) ?? new Set();
    waiting.add(retry);
    this.waiting.set(bpmnProcessId, waiting);
  }

  forget(bpmnProcessId: BpmnProcessId): void {
    if (!this.blocks(bpmnProcessId)) {
      this.runs.delete(bpmnProcessId);
    }
  }

  private blocks(bpmnProcessId: BpmnProcessId): boolean {
    const run = this.runs.get(bpmnProcessId);
    return run?.isActive() === true || run?.lingers === true;
  }
}
