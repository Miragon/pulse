/**
 * The errors of exit code 9 (design §17.2.4): every request succeeded, but the process did not
 * reach the expected state. Commands print their view on stdout before these errors. Pure.
 */

import { OperateError } from '../errors.js';
import { formatDuration } from '../operation/durations.js';
import { compact } from '../util.js';
import { isAdvanceable, isSuspendedJob } from './next.js';
import type { IncidentView, WaitState } from './types.js';

/** A job that failed when operate executed it. */
export interface JobFailure {
  readonly jobId: string;
  readonly activityId?: string;
  readonly processInstanceId?: string;
  readonly message: string;
  readonly rootCause: string;
}

function incidentText(incident: IncidentView): string {
  return `${incident.type} at ${incident.activityId}: ${incident.rootCause ?? incident.message ?? ''}`;
}

export function incidentError(id: string, incidents: readonly IncidentView[]): OperateError {
  const [first] = incidents;
  let what = 'an incident';
  if (first !== undefined) {
    what =
      incidents.length === 1
        ? `an incident: ${incidentText(first)}`
        : `${incidents.length} incidents, the first: ${incidentText(first)}`;
  }
  // the view on stdout has the messages and root causes; the error names the incidents only
  const named = incidents.map((incident) =>
    compact({
      id: incident.id,
      type: incident.type,
      activityId: incident.activityId,
      processInstanceId: incident.processInstanceId,
    }),
  );
  return new OperateError('INCIDENT', `Process instance ${id} has ${what}`, {
    hint: `Fix the cause, then run \`operate retry ${id}\`; --no-fail-on-incident keeps waiting despite incidents.`,
    data: { incidents: named },
  });
}

const LISTED_WAITS = 3;

/**
 * Why the wait timed out: due jobs remained (the job executor may be backing off), or no job was
 * due and the instance rests where it waits (`idleAt`, a typo in --until fits this too).
 */
function timeoutHint(id: string, idleAt: readonly WaitState[] | undefined): string {
  if (idleAt === undefined || idleAt.length === 0) {
    return `The job executor may be backing off (up to 60 s on an idle engine): raise --wait-timeout, execute due jobs with \`operate wait ${id} --execute-jobs\`, or run \`operate status\` to see overdue jobs.`;
  }
  const places = idleAt.slice(0, LISTED_WAITS).map(placeText);
  const more = idleAt.length > LISTED_WAITS ? ', ...' : '';
  return `No job is due: the instance rests at ${places.join(', ')}${more}. ${moveText(id, idleAt)}, or check the --until condition against \`operate inspect ${id}\`.`;
}

function placeText(wait: WaitState): string {
  return `${wait.activityId} (${wait.kind}${isSuspendedJob(wait) ? ', suspended' : ''})`;
}

/** `operate advance`, unless only a suspended job could move (advance refuses to execute it). */
function moveText(id: string, idleAt: readonly WaitState[]): string {
  const movable = idleAt.some((wait) => isAdvanceable(wait) && !isSuspendedJob(wait));
  const job = idleAt.find(isSuspendedJob);
  if (movable || job === undefined || !('jobId' in job)) {
    return `Move it with \`operate advance ${id}\``;
  }
  return `Activate the suspended job with \`operate job activate ${job.jobId}\``;
}

export function timeoutError(
  id: string,
  until: readonly string[],
  timeoutMs: number,
  progress: {
    readonly elapsedMs: number;
    readonly polls: number;
    /** The wait states when no job was due at the end; undefined when jobs were due. */
    readonly idleAt?: readonly WaitState[] | undefined;
  },
): OperateError {
  return new OperateError(
    'WAIT_TIMEOUT',
    `Timed out after ${formatDuration(timeoutMs)} waiting until ${until.join(' or ')} (process instance ${id})`,
    {
      hint: timeoutHint(id, progress.idleAt),
      data: { until, elapsedMs: progress.elapsedMs, polls: progress.polls },
    },
  );
}

export function endedError(id: string, until: readonly string[], state: string): OperateError {
  return new OperateError(
    'INSTANCE_ENDED',
    `Process instance ${id} ended (${state}) before reaching ${until.join(' or ')}`,
    {
      hint: `\`operate inspect ${id} --history\` shows the path it took.`,
      data: { until, state },
    },
  );
}

function inspectCommand(failure: JobFailure | undefined): string {
  const instance = failure?.processInstanceId ?? '<id>';
  return `operate inspect ${instance} --stacktrace`;
}

function failureText(failure: JobFailure | undefined): string {
  if (failure === undefined) return 'Job failed';
  const where = failure.activityId === undefined ? '' : ` at ${failure.activityId}`;
  return `Job ${failure.jobId}${where} failed: ${failure.message}`;
}

/** JOB_FAILED for the failed entries (`data`); the first one names the message. */
export function jobFailedError(
  failures: readonly JobFailure[],
  data: readonly unknown[] = failures,
): OperateError {
  const [first] = failures;
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
  return new OperateError('JOB_FAILED', `${failureText(first)}${more}`, {
    hint: `\`${inspectCommand(first)}\` shows the stacktrace; fix the cause, then retry.`,
    data: { failures: data },
  });
}
