import type { BulkFailure, BulkOperation, BulkOperationKind } from '../model/bulk-operations.js';
import { BulkOperationId, IsoTimestamp, type InstanceId } from '../model/ids.js';
import type { MigrationPlan } from '../model/migrations.js';
import { RuntimeError } from '../model/runtime-error.js';
import type { FakeBulkOperation, FakeEngineState } from './fake-engine-state.js';
import { FakeMigration } from './fake-migration.js';
import { FakeTransitions } from './fake-transitions.js';

const ITEMS_PER_READ = 10;
const STARTED_AT = IsoTimestamp('2026-10-21T09:00:00Z');
const ENDED_AT = IsoTimestamp('2026-10-21T09:01:00Z');

export interface FakeSubmission {
  readonly id: BulkOperationId;
  readonly state: FakeEngineState;
}

interface WorkedItems {
  readonly state: FakeEngineState;
  readonly completed: number;
  readonly failures: readonly BulkFailure[];
}

export class FakeBulkWork {
  constructor(private readonly state: FakeEngineState) {}

  submitted(instanceIds: readonly InstanceId[]): FakeSubmission {
    return this.started('cancelInstances', instanceIds);
  }

  submittedMigration(plan: MigrationPlan, instanceIds: readonly InstanceId[]): FakeSubmission {
    const running = new FakeMigration(this.state).runningOnSource(plan, instanceIds);
    return this.started('migrateInstances', running, plan);
  }

  progressed(id: BulkOperationId): FakeEngineState {
    const entry = this.entryOf(id);
    if (entry?.operation.state !== 'running' || entry.pending.length === 0) {
      return this.state;
    }
    const pending = entry.pending.slice(ITEMS_PER_READ);
    const worked = this.worked(entry, entry.pending.slice(0, ITEMS_PER_READ));
    const failures = [...(entry.failures ?? []), ...worked.failures];
    const operation: BulkOperation = {
      ...entry.operation,
      completed: (entry.operation.completed ?? 0) + worked.completed,
      failed: failures.length,
      ...(pending.length === 0 && failures.length === 0
        ? { state: 'ended', endedAt: ENDED_AT }
        : {}),
    };
    return new FakeBulkWork(worked.state).replaced({ ...entry, operation, pending, failures });
  }

  stopped(id: BulkOperationId): FakeEngineState {
    const entry = this.entryOf(id);
    if (entry === undefined) {
      throw new RuntimeError('rejected', `Bulk operation ${id} does not exist.`);
    }
    if (entry.operation.state === 'ended') {
      return this.state;
    }
    return this.replaced({
      ...entry,
      operation: { ...entry.operation, state: 'ended', endedAt: ENDED_AT },
      pending: [],
    });
  }

  operation(id: BulkOperationId): BulkOperation | undefined {
    return this.entryOf(id)?.operation;
  }

  failures(id: BulkOperationId): readonly BulkFailure[] {
    return this.entryOf(id)?.failures ?? [];
  }

  private started(
    kind: BulkOperationKind,
    instanceIds: readonly InstanceId[],
    plan?: MigrationPlan,
  ): FakeSubmission {
    if (instanceIds.length === 0) {
      throw new RuntimeError('rejected', 'There is no instance to work on.');
    }
    const id = BulkOperationId(`fake-bulk-${this.operations().length + 1}`);
    const operation: BulkOperation = {
      id,
      kind,
      state: 'running',
      total: instanceIds.length,
      completed: 0,
      failed: 0,
      startedAt: STARTED_AT,
    };
    const entry: FakeBulkOperation = {
      operation,
      pending: instanceIds,
      ...(plan === undefined ? {} : { plan }),
    };
    return { id, state: { ...this.state, bulkOperations: [...this.operations(), entry] } };
  }

  private worked(entry: FakeBulkOperation, items: readonly InstanceId[]): WorkedItems {
    if (entry.plan === undefined) {
      const state = new FakeTransitions(this.state).cancelled(items);
      return { state, completed: items.length, failures: [] };
    }
    const work = new FakeMigration(this.state).worked(entry.plan, items);
    return { state: work.state, completed: work.migrated, failures: work.failures };
  }

  private operations(): readonly FakeBulkOperation[] {
    return this.state.bulkOperations ?? [];
  }

  private entryOf(id: BulkOperationId): FakeBulkOperation | undefined {
    return this.operations().find((entry) => entry.operation.id === id);
  }

  private replaced(next: FakeBulkOperation): FakeEngineState {
    return {
      ...this.state,
      bulkOperations: this.operations().map((entry) =>
        entry.operation.id === next.operation.id ? next : entry,
      ),
    };
  }
}
