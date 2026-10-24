import {
  BulkOperationId,
  type BulkOperation,
  type BulkOperationKind,
} from '../../../contract/index.js';
import type { BatchStatisticsView, BatchView, HistoricBatchView } from '../engine-cli/index.js';
import { Present } from '../engine-cli/index.js';
import { Timestamps } from './timestamps.js';

const KINDS: Readonly<Record<string, BulkOperationKind>> = {
  'instance-deletion': 'cancelInstances',
  'instance-migration': 'migrateInstances',
};

export class BulkOperationMapper {
  running(batch: BatchStatisticsView): BulkOperation | undefined {
    const base = this.baseOf(batch);
    if (base === undefined) {
      return undefined;
    }
    const items = (jobs: number): number =>
      Math.min(jobs * batch.invocationsPerBatchJob, base.total);
    return {
      ...base,
      state: batch.suspended ? 'suspended' : 'running',
      completed: items(batch.completedJobs),
      failed: items(batch.failedJobs),
    };
  }

  ended(batch: HistoricBatchView): BulkOperation | undefined {
    const base = this.baseOf(batch);
    return base === undefined
      ? undefined
      : {
          ...base,
          state: 'ended',
          ...Present.fields({ endedAt: Timestamps.optional(batch.endTime) }),
        };
  }

  private baseOf(batch: BatchView): (Omit<BulkOperation, 'state'> & { total: number }) | undefined {
    const kind = KINDS[batch.type];
    if (kind === undefined) {
      return undefined;
    }
    return {
      id: BulkOperationId(batch.id),
      kind,
      total: batch.totalJobs * batch.invocationsPerBatchJob,
      ...Present.fields({ startedAt: Timestamps.optional(batch.startTime) }),
    };
  }
}
