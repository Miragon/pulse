/**
 * Aggregation of `operate status` (design §17.9): definitions, incident groups, external task
 * topics, jobs, tasks and batches from the responses of round 1. Pure; `now` is injected (engine
 * and client clocks are assumed to agree, as for local containers).
 */

import { compact } from '../util.js';
import { isRetryable } from './next.js';
import {
  amount,
  compareText,
  compareTime,
  definitionKeyOf,
  engineTime,
  field,
  num,
  type Rec,
  records,
  str,
} from './records.js';
import { shellWord } from './shell.js';

export interface DefinitionStatus {
  readonly key: string;
  readonly name?: string;
  readonly latestVersion: number;
  readonly versions: number;
  readonly instances: number;
  readonly failedJobs: number;
  readonly incidents: number;
}

export interface IncidentGroup {
  readonly processDefinitionKey: string;
  readonly activityId: string;
  /** Only for incidents without a process definition (standalone jobs). */
  readonly jobDefinitionId?: string;
  readonly type: string;
  readonly message: string;
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly rootCause?: string;
  readonly processInstanceIds: readonly string[];
  readonly next: string;
}

export interface TopicStatus {
  readonly topic: string;
  readonly waiting: number;
  readonly locked: number;
  readonly lockExpired: number;
  readonly failed: number;
  readonly workers: readonly string[];
  readonly oldestWaitingSince?: string;
  /** The earliest expired lock (LOCK_EXPIRED waits `--stale-after` past it). */
  readonly oldestLockExpiredAt?: string;
}

export interface JobStatus {
  readonly executable: number;
  readonly overdue: number;
  readonly oldestReadySince?: string;
}

/** Incident groups list at most this many instance ids. */
const LISTED_INSTANCES = 3;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RUN = /[0-9a-f]{16,}/gi;
const DIGITS = /\d+/g;

/** The message with UUIDs, hex runs of 16+ characters and digit runs masked as `#`. */
export function messagePattern(message: string): string {
  return message.replace(UUID, '#').replace(HEX_RUN, '#').replace(DIGITS, '#');
}

/** Process definitions of the statistics rows by id: key and version. */
function definitionsById(statistics: readonly Rec[]): Map<string, Rec> {
  return new Map(
    statistics.flatMap((row) => {
      const definition = row.definition;
      const dto = typeof definition === 'object' && definition !== null ? (definition as Rec) : row;
      const id = str(dto, 'id') ?? str(row, 'id');
      return id === undefined ? [] : [[id, dto] as const];
    }),
  );
}

function incidentCount(row: Rec): number {
  return records(row.incidents).reduce((sum, entry) => sum + amount(entry, 'incidentCount'), 0);
}

/** The definition key of a statistics row. */
function statisticsKey(row: Rec): string {
  return str(row.definition as Rec | undefined, 'key') ?? definitionKeyOf(str(row, 'id')) ?? '';
}

/** Named keys without any deployed definition (a typo, or another engine). */
export function unknownKeys(statistics: readonly Rec[], keys: readonly string[]): string[] {
  const known = new Set(statistics.map(statisticsKey));
  return keys.filter((key) => !known.has(key));
}

/** Statistics summed per key; keys without instances, failed jobs and incidents only when named. */
export function definitionStatus(
  statistics: readonly Rec[],
  keys: readonly string[],
): DefinitionStatus[] {
  const byKey = new Map<string, Rec[]>();
  for (const row of statistics) {
    const key = statisticsKey(row);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey.entries()]
    .filter(([key]) => keys.length === 0 || keys.includes(key))
    .map(([key, rows]) => {
      const definitions = rows.map((row) => (row.definition ?? {}) as Rec);
      const latest = definitions.toSorted(
        (left, right) => amount(right, 'version') - amount(left, 'version'),
      )[0];
      const sum = (read: (row: Rec) => number) => rows.reduce((total, row) => total + read(row), 0);
      return {
        key,
        ...compact({ name: str(latest, 'name') }),
        latestVersion: amount(latest, 'version'),
        versions: rows.length,
        instances: sum((row) => amount(row, 'instances')),
        failedJobs: sum((row) => amount(row, 'failedJobs')),
        incidents: sum(incidentCount),
      };
    })
    .filter(
      (status) =>
        keys.includes(status.key) || status.instances + status.failedJobs + status.incidents > 0,
    )
    .toSorted(
      (left, right) =>
        right.incidents - left.incidents ||
        right.failedJobs - left.failedJobs ||
        right.instances - left.instances ||
        compareText(left.key, right.key),
    );
}

function groupNext(key: string, activityId: string, type: string, jobDefinitionId?: string) {
  if (key === '') {
    // a job outside any process definition (a batch or a history cleanup job)
    return jobDefinitionId === undefined
      ? `operate incident list --incident-type ${shellWord(type)}`
      : `operate job list --job-definition-id ${shellWord(jobDefinitionId)} --with-exception`;
  }
  const definition = shellWord(key);
  const activity = shellWord(activityId);
  return isRetryable(type)
    ? `operate retry --process-definition-key ${definition} --activity-id ${activity} --dry-run`
    : `operate incident list --process-definition-key-in ${definition} --activity-id ${activity}`;
}

/** Newest first, then by id. */
function newestFirst(left: Rec, right: Rec): number {
  return (
    compareTime(str(right, 'incidentTimestamp'), str(left, 'incidentTimestamp')) ||
    compareText(field(left, 'id'), field(right, 'id'))
  );
}

export interface GroupedIncidents {
  readonly groups: readonly (IncidentGroup & { readonly newest: Rec })[];
  readonly propagated: number;
}

function isRoot(incident: Rec): boolean {
  return str(incident, 'id') === str(incident, 'rootCauseIncidentId');
}

/** The group of an incident: key (else its job definition), activity, type, message pattern. */
function groupId(incident: Rec, key: string): string {
  return [
    key === '' ? `job-definition:${field(incident, 'jobDefinitionId')}` : key,
    field(incident, 'activityId'),
    field(incident, 'incidentType'),
    messagePattern(field(incident, 'incidentMessage')),
  ].join('\u0000');
}

function groupOf(members: readonly Rec[]): IncidentGroup & { readonly newest: Rec } {
  const newest = members[0] ?? {};
  const key = field(newest, 'processDefinitionKey');
  const activityId = field(newest, 'activityId');
  const type = field(newest, 'incidentType');
  const jobDefinitionId = key === '' ? str(newest, 'jobDefinitionId') : undefined;
  return {
    processDefinitionKey: key,
    activityId,
    ...compact({ jobDefinitionId }),
    type,
    message: field(newest, 'incidentMessage'),
    count: members.length,
    firstAt: str(members.at(-1), 'incidentTimestamp') ?? '',
    lastAt: field(newest, 'incidentTimestamp'),
    processInstanceIds: [
      ...new Set(members.flatMap((member) => str(member, 'processInstanceId') ?? [])),
    ].slice(0, LISTED_INSTANCES),
    next: groupNext(key, activityId, type, jobDefinitionId),
    newest,
  };
}

/**
 * Root cause incidents grouped by key, activity, type and message pattern; largest groups first.
 * Incidents of the failed jobs of a batch (`batchJobDefinitions`) are left out: BATCH_FAILURES
 * reports them.
 */
export function groupIncidents(
  incidents: readonly Rec[],
  statistics: readonly Rec[],
  batchJobDefinitions: ReadonlySet<string> = new Set(),
): GroupedIncidents {
  const definitions = definitionsById(statistics);
  const roots = incidents
    .filter(isRoot)
    .filter((incident) => !batchJobDefinitions.has(field(incident, 'jobDefinitionId')));
  const groups = new Map<string, Rec[]>();
  for (const incident of roots.toSorted(newestFirst)) {
    const definitionId = str(incident, 'processDefinitionId');
    const key =
      str(definitions.get(definitionId ?? ''), 'key') ?? definitionKeyOf(definitionId) ?? '';
    const id = groupId(incident, key);
    groups.set(id, [...(groups.get(id) ?? []), { ...incident, processDefinitionKey: key }]);
  }
  return {
    groups: [...groups.values()]
      .map(groupOf)
      .toSorted(
        (left, right) =>
          right.count - left.count ||
          compareTime(right.lastAt, left.lastAt) ||
          compareText(left.next, right.next),
      ),
    propagated: incidents.filter((incident) => !isRoot(incident)).length,
  };
}

type TaskState = 'failed' | 'locked' | 'lockExpired' | 'waiting';

/**
 * Failed (no retries left), locked (lock in the future), waiting (never locked, or a reported
 * failure whose retry is due: the engine keeps the worker and sets the lock to the retry time),
 * else lock expired (a worker crashed or exceeded its lock).
 */
function taskState(task: Rec, now: number): TaskState {
  if (num(task, 'retries') === 0) return 'failed';
  const lock = engineTime(str(task, 'lockExpirationTime'));
  if (lock === undefined) return 'waiting';
  if (lock > now) return 'locked';
  return str(task, 'errorMessage') === undefined ? 'lockExpired' : 'waiting';
}

/** Since when a task waits: its retry time after a failure, else its create time. */
function waitingSince(task: Rec): string | undefined {
  return str(task, 'errorMessage') === undefined
    ? str(task, 'createTime')
    : (str(task, 'lockExpirationTime') ?? str(task, 'createTime'));
}

function earliest(times: readonly (string | undefined)[]): string | undefined {
  return times.filter((time) => time !== undefined).toSorted(compareTime)[0];
}

function topicOf(topic: string, members: readonly Rec[], now: number): TopicStatus {
  const of = (state: TaskState) => members.filter((task) => taskState(task, now) === state);
  const waiting = of('waiting');
  const expired = of('lockExpired');
  return {
    topic,
    waiting: waiting.length,
    locked: of('locked').length,
    lockExpired: expired.length,
    failed: of('failed').length,
    workers: [...new Set(of('locked').flatMap((task) => str(task, 'workerId') ?? []))].sort(
      compareText,
    ),
    ...compact({
      oldestWaitingSince: earliest(waiting.map(waitingSince)),
      oldestLockExpiredAt: earliest(expired.map((task) => str(task, 'lockExpirationTime'))),
    }),
  };
}

/** External tasks per topic, a partition: failed, locked, lock expired or waiting. */
export function topicStatus(tasks: readonly Rec[], now: number): TopicStatus[] {
  const topics = new Map<string, Rec[]>();
  for (const task of tasks) {
    const topic = field(task, 'topicName');
    topics.set(topic, [...(topics.get(topic) ?? []), task]);
  }
  return [...topics.entries()]
    .map(([topic, members]) => topicOf(topic, members, now))
    .toSorted((left, right) => compareText(left.topic, right.topic));
}

/** Executable jobs whose due date (or create time) is older than the threshold are overdue. */
export function jobStatus(
  executable: number,
  staleJobs: readonly Rec[],
  threshold: number,
): JobStatus {
  const ready = staleJobs
    .map((job) => str(job, 'dueDate') ?? str(job, 'createTime'))
    .filter((time) => (engineTime(time) ?? Number.POSITIVE_INFINITY) < threshold)
    .toSorted(compareTime);
  return { executable, overdue: ready.length, ...compact({ oldestReadySince: ready[0] }) };
}
