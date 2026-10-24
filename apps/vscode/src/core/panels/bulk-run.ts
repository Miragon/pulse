import type {
  BulkFailure,
  BulkOperation,
  BulkOperationId,
  DefinitionId,
  InstanceId,
} from '../../contract/index.js';
import type { BulkProgress } from '../protocol/index.js';
import type { BulkAction } from './bulk-action.js';

export interface BulkPlan {
  readonly action: BulkAction;
  readonly definitionId: DefinitionId;
  readonly version: number;
  readonly ids: readonly InstanceId[];
  readonly skipped: number;
  readonly leftOut?: number;
}

export type BulkPhase =
  | 'submitting'
  | 'running'
  | 'stopping'
  | 'settling'
  | 'stopped'
  | 'finished'
  | 'failed'
  | 'unknown';

const ACTIVE: ReadonlySet<BulkPhase> = new Set(['submitting', 'running', 'stopping', 'settling']);

export class BulkRun {
  private current: BulkPhase = 'submitting';
  private operation: BulkOperationId | undefined;
  private counts: BulkProgress;
  private left: number | undefined;
  private arrivedCount: number | undefined;
  private reasons: readonly BulkFailure[] | undefined;
  private kept = false;
  private removing = false;
  private problem: string | undefined;
  private unread: string | undefined;
  private changedAt: number;
  private stopRequested = false;
  private suspendedOnly = false;
  private follower: object | undefined;
  private readonly waiting = new Set<() => void>();

  constructor(
    readonly plan: BulkPlan,
    now: Date,
  ) {
    this.changedAt = now.getTime();
    this.counts = { total: plan.ids.length, done: 0, failed: 0 };
  }

  get phase(): BulkPhase {
    return this.current;
  }

  get operationId(): BulkOperationId | undefined {
    return this.operation;
  }

  get progress(): BulkProgress {
    return this.counts;
  }

  get remaining(): number | undefined {
    return this.left;
  }

  get arrived(): number | undefined {
    return this.arrivedCount;
  }

  get failures(): readonly BulkFailure[] | undefined {
    return this.reasons;
  }

  get lingers(): boolean {
    return this.kept;
  }

  get message(): string | undefined {
    return this.problem;
  }

  get readProblem(): string | undefined {
    return this.unread;
  }

  get lastChangeAt(): number {
    return this.changedAt;
  }

  get halted(): boolean {
    return this.suspendedOnly;
  }

  isActive(): boolean {
    return ACTIVE.has(this.current);
  }

  stopTarget(): BulkOperationId | undefined {
    const stoppable =
      this.current === 'running' ||
      (this.current === 'stopped' && this.halted) ||
      (this.current === 'finished' && this.kept);
    return stoppable ? this.operation : undefined;
  }

  claim(follower: object, retry: () => void): boolean {
    if (this.follower !== undefined || this.current === 'submitting') {
      this.waiting.add(retry);
      return false;
    }
    this.follower = follower;
    return true;
  }

  release(follower: object): void {
    if (this.follower === follower) {
      this.follower = undefined;
      this.wakeWaiting();
    }
  }

  submitted(operationId: BulkOperationId, now: Date): void {
    this.operation = operationId;
    this.current = 'running';
    this.changedAt = now.getTime();
    this.wakeWaiting();
  }

  failed(message: string, outcomeUnknown: boolean): void {
    this.current = outcomeUnknown ? 'unknown' : 'failed';
    this.problem = message;
  }

  noteFailures(failures: readonly BulkFailure[]): void {
    this.reasons = failures;
  }

  stopping(): void {
    this.removing = this.current === 'finished';
    this.stopRequested = true;
    this.current = 'stopping';
    this.problem = undefined;
  }

  stopFailed(message: string): void {
    if (this.removing) {
      this.removing = false;
      this.current = 'finished';
      this.problem = message;
      return;
    }
    this.current = this.halted ? 'stopped' : 'running';
    this.stopRequested = this.halted;
    this.problem = message;
  }

  readFailed(problem: string): void {
    this.unread = problem;
  }

  observed(operation: BulkOperation | undefined, now: Date): boolean {
    this.unread = undefined;
    if (operation === undefined) {
      this.suspendedOnly = false;
      this.kept = false;
      return true;
    }
    const total = this.plan.ids.length;
    const next: BulkProgress = {
      total,
      done: Math.min(operation.completed ?? this.counts.done, total),
      failed: Math.min(operation.failed ?? this.counts.failed, total),
    };
    if (next.done !== this.counts.done || next.failed !== this.counts.failed) {
      this.changedAt = now.getTime();
    }
    this.counts = next;
    this.suspendedOnly = this.stopRequested && operation.state === 'suspended';
    this.kept = operation.state !== 'ended' && next.failed > 0;
    return this.isWorkedOff(operation);
  }

  reconciled(remaining: number, arrived?: number): void {
    this.left = remaining;
    this.arrivedCount = arrived;
    if (this.current === 'unknown' || this.current === 'failed') {
      return;
    }
    if (this.removing) {
      this.settleRemoval();
      return;
    }
    if (this.stopRequested) {
      this.current = this.current === 'stopping' ? 'settling' : 'stopped';
      return;
    }
    this.current = 'finished';
  }

  watchedAgain(now: Date): void {
    this.changedAt = now.getTime();
  }

  private settleRemoval(): void {
    if (this.current === 'stopping') {
      this.current = 'settling';
      return;
    }
    this.removing = false;
    this.stopRequested = false;
    this.kept = this.suspendedOnly;
    this.current = 'finished';
  }

  private wakeWaiting(): void {
    const retries = [...this.waiting];
    this.waiting.clear();
    for (const retry of retries) {
      retry();
    }
  }

  private isWorkedOff(operation: BulkOperation): boolean {
    if (operation.state === 'ended' || (this.stopRequested && operation.state !== 'running')) {
      return true;
    }
    const total = operation.total ?? 0;
    return total > 0 && (operation.completed ?? 0) + (operation.failed ?? 0) >= total;
  }
}
