/**
 * The findings of `operate status` (design §17.9): pure rules over the aggregated status, each
 * naming the next command, and the overall status (the highest severity, else `ok`).
 */

import { OperateError } from '../errors.js';
import { formatDuration } from '../operation/durations.js';
import { amount, compareText, engineTime, field, type Rec, str } from './records.js';
import { shellWord } from './shell.js';
import type { IncidentGroup, JobStatus, TopicStatus } from './status.js';

export type Severity = 'warning' | 'critical';
export type EngineStatus = 'ok' | Severity;

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly next?: string;
}

export interface FindingInput {
  readonly jobs: JobStatus;
  readonly incidents: readonly IncidentGroup[];
  readonly externalTasks: readonly TopicStatus[];
  readonly batches: readonly Rec[];
  /** `--process-definition-key` values without a deployed definition. */
  readonly unknownKeys?: readonly string[];
  readonly staleAfterMs: number;
  readonly now: number;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function overdueJobs(input: FindingInput): Finding[] {
  const { overdue, oldestReadySince } = input.jobs;
  if (overdue === 0) return [];
  const since = oldestReadySince === undefined ? '' : ` (oldest since ${oldestReadySince})`;
  return [
    {
      severity: 'critical',
      code: 'JOBS_OVERDUE',
      message: `${plural(overdue, 'executable job')} ${overdue === 1 ? 'has' : 'have'} waited longer than ${formatDuration(input.staleAfterMs)}${since}: is the job executor running?`,
      next: 'operate job list --executable --sort-by jobDueDate --sort-order asc --max-results 10',
    },
  ];
}

function where(group: IncidentGroup): string {
  return group.processDefinitionKey === ''
    ? `job definition ${group.jobDefinitionId ?? '(unknown)'}`
    : `${group.processDefinitionKey}/${group.activityId}`;
}

function incidentFindings(input: FindingInput): Finding[] {
  return input.incidents.map((group) => ({
    severity: 'warning',
    code: 'INCIDENTS',
    message: `${plural(group.count, `${group.type} incident`)} at ${where(group)}: ${group.rootCause ?? group.message}`,
    next: group.next,
  }));
}

function workerFindings(input: FindingInput): Finding[] {
  const threshold = input.now - input.staleAfterMs;
  return input.externalTasks.flatMap((topic): Finding[] => {
    const findings: Finding[] = [];
    const oldest = engineTime(topic.oldestWaitingSince);
    if (topic.waiting > 0 && topic.locked === 0 && oldest !== undefined && oldest < threshold) {
      findings.push({
        severity: 'warning',
        code: 'NO_WORKER',
        message: `topic ${topic.topic}: ${plural(topic.waiting, 'task')} wait since ${topic.oldestWaitingSince ?? ''}, none is locked: is a worker subscribed?`,
        next: `operate external-task list --topic-name ${shellWord(topic.topic)} --not-locked`,
      });
    }
    const expired = engineTime(topic.oldestLockExpiredAt);
    if (topic.lockExpired > 0 && expired !== undefined && expired < threshold) {
      findings.push({
        severity: 'warning',
        code: 'LOCK_EXPIRED',
        message: `topic ${topic.topic}: ${plural(topic.lockExpired, 'task')} with an expired lock (the oldest since ${topic.oldestLockExpiredAt ?? ''}): a worker crashed or exceeded its lock`,
        next: `operate external-task list --topic-name ${shellWord(topic.topic)} --not-locked --with-retries-left`,
      });
    }
    return findings;
  });
}

function batchFindings(input: FindingInput): Finding[] {
  return input.batches.flatMap((batch): Finding[] => {
    const failed = amount(batch, 'failedJobs');
    if (failed === 0) return [];
    const jobDefinition = str(batch, 'batchJobDefinitionId') ?? '<id>';
    return [
      {
        severity: 'warning',
        code: 'BATCH_FAILURES',
        message: `batch ${field(batch, 'id')} (${field(batch, 'type')}): ${plural(failed, 'failed job')}`,
        next: `operate job list --job-definition-id ${shellWord(jobDefinition)} --with-exception`,
      },
    ];
  });
}

function keyFindings(input: FindingInput): Finding[] {
  return (input.unknownKeys ?? []).map((key) => ({
    severity: 'warning',
    code: 'UNKNOWN_KEY',
    message: `process definition key ${key} is not deployed`,
    next: 'operate process-definition list --latest-version --sort-by key --sort-order asc',
  }));
}

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'warning'];

/** Every finding, critical first, then by code and message. */
export function findings(input: FindingInput): Finding[] {
  return [
    ...overdueJobs(input),
    ...incidentFindings(input),
    ...workerFindings(input),
    ...batchFindings(input),
    ...keyFindings(input),
  ].toSorted(
    (left, right) =>
      SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );
}

/** The highest severity of the findings, else `ok`. */
export function engineStatus(list: readonly Finding[]): EngineStatus {
  return list[0]?.severity ?? 'ok';
}

/** CHECK_FAILED when the status reaches the `--fail-on` level. */
export function checkFailure(
  status: EngineStatus,
  list: readonly Finding[],
  failOn: Severity | undefined,
): OperateError | undefined {
  const reached = failOn === 'warning' ? status !== 'ok' : status === 'critical';
  if (failOn === undefined || !reached) return undefined;
  const next = list[0]?.next;
  return new OperateError(
    'CHECK_FAILED',
    `Engine status is ${status} (${plural(list.length, 'finding')})`,
    {
      hint: next === undefined ? 'The findings say what is wrong.' : `Start with: ${next}`,
      data: { status, findings: list },
    },
  );
}
