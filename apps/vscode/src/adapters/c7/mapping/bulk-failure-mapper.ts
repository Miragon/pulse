import { InstanceId, type BulkFailure } from '../../../contract/index.js';
import type { FailedJobView } from '../engine-cli/index.js';
import type { Mapper } from './mapper.js';

const MAX_REASON_LENGTH = 300;
const NAMED_INSTANCE = /process instance '([^']+)'/i;
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu;

export class BulkFailureMapper implements Mapper<FailedJobView, BulkFailure> {
  map(job: FailedJobView): BulkFailure {
    const message = job.exceptionMessage ?? `Job ${job.id} failed without a message.`;
    const reason = message.replace(UNPRINTABLE, ' ').trim();
    const named = NAMED_INSTANCE.exec(message)?.[1];
    return {
      reason:
        reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason,
      ...(named === undefined ? {} : { instanceId: InstanceId(named) }),
    };
  }
}
