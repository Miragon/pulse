/**
 * Executing a job (design §17.2.7), shared by advance (timers, async jobs), `retry --now` and
 * `wait --execute-jobs`. The engine reports a job that ran and failed as 404 (the job stays with
 * one retry less), so every error is checked against the job itself.
 */

import type { EnginePort } from '../engine-port/engine-port.js';
import { OperateError } from '../errors.js';
import { compact } from '../util.js';

import { type Rec, records, str } from './records.js';
import { rootCause } from './root-cause.js';

export type JobOutcome =
  | { readonly result: 'executed'; readonly executedBy?: 'jobExecutor' }
  | {
      readonly result: 'failed';
      readonly jobId: string;
      readonly message: string;
      readonly rootCause: string;
      readonly activityId?: string;
      readonly processInstanceId?: string;
    };

/** Delay before reading a job again after an optimistic locking conflict. */
const CONFLICT_DELAY_MS = 250;

const EXECUTED: JobOutcome = { result: 'executed' };
const BY_JOB_EXECUTOR: JobOutcome = { result: 'executed', executedBy: 'jobExecutor' };

/** An error answer of the engine about the job (not 401/403, not a network failure). */
function isJobError(error: unknown): error is OperateError {
  const status = error instanceof OperateError ? error.details.status : undefined;
  return status !== undefined && status >= 400 && status !== 401 && status !== 403;
}

/** The job executor ran the job at the same time. */
function isConflict(error: OperateError): boolean {
  const text = `${error.details.engineType ?? ''} ${error.details.engineMessage ?? ''}`;
  return text.includes('OptimisticLockingException');
}

function jobInput(jobId: string) {
  return { pathArgs: [jobId], query: {} };
}

async function findJob(port: EnginePort, jobId: string): Promise<Rec | undefined> {
  return records([await port.find('getJob', jobInput(jobId))])[0];
}

/** The job still exists: it failed (cause from its stacktrace); else someone else ran it. */
async function afterError(
  port: EnginePort,
  jobId: string,
  error: OperateError,
): Promise<JobOutcome> {
  const job = await findJob(port, jobId);
  if (job === undefined) return BY_JOB_EXECUTOR;
  const message = error.details.engineMessage ?? error.message;
  const stacktrace = await port.text('getStacktrace', [jobId]);
  return {
    result: 'failed',
    jobId,
    message,
    rootCause: (stacktrace === undefined ? undefined : rootCause(stacktrace)) ?? message,
    ...compact({
      activityId: str(job, 'failedActivityId'),
      processInstanceId: str(job, 'processInstanceId'),
    }),
  };
}

async function execute(port: EnginePort, jobId: string): Promise<OperateError | undefined> {
  try {
    await port.call('executeJob', jobInput(jobId));
    return undefined;
  } catch (error) {
    if (isJobError(error)) return error;
    throw error;
  }
}

/** Executes a job: `executed` (maybe by the job executor first) or `failed` with its root cause. */
export async function executeJob(
  port: EnginePort,
  jobId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<JobOutcome> {
  const error = await execute(port, jobId);
  if (error === undefined) return EXECUTED;
  if (!isConflict(error)) return afterError(port, jobId, error);
  await sleep(CONFLICT_DELAY_MS);
  if ((await findJob(port, jobId)) === undefined) return BY_JOB_EXECUTOR;
  const second = await execute(port, jobId);
  return second === undefined ? EXECUTED : afterError(port, jobId, second);
}
