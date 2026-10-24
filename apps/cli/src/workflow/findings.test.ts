import { describe, expect, it } from 'vitest';
import { checkFailure, engineStatus, type FindingInput, findings } from './findings.js';
import type { IncidentGroup } from './status.js';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

const QUIET: FindingInput = {
  jobs: { executable: 0, overdue: 0 },
  incidents: [],
  externalTasks: [],
  batches: [],
  staleAfterMs: 300_000,
  now: NOW,
};

const GROUP: IncidentGroup = {
  processDefinitionKey: 'order',
  activityId: 'book',
  type: 'failedJob',
  message: 'boom',
  count: 2,
  firstAt: 'a',
  lastAt: 'b',
  rootCause: 'PropertyNotFoundException: missingBean',
  processInstanceIds: ['p1'],
  next: 'operate retry --process-definition-key order --activity-id book --dry-run',
};

const { rootCause: _, ...withoutCause } = GROUP;

describe('findings', () => {
  it('finds nothing on a quiet engine: status ok, no CHECK_FAILED', () => {
    expect(findings(QUIET)).toEqual([]);
    expect(engineStatus([])).toBe('ok');
    expect(checkFailure('ok', [], 'warning')).toBeUndefined();
  });

  it('reports every rule with its next command, critical first, then by code and message', () => {
    const list = findings({
      ...QUIET,
      jobs: { executable: 3, overdue: 2, oldestReadySince: '2026-01-01T10:00:00.000+0000' },
      incidents: [GROUP, { ...withoutCause, count: 1, message: 'plain' }],
      externalTasks: [
        {
          topic: 'mail',
          waiting: 3,
          locked: 0,
          lockExpired: 1,
          failed: 0,
          workers: [],
          oldestWaitingSince: '2026-01-01T11:00:00.000+0000',
          oldestLockExpiredAt: '2026-01-01T11:30:00.000+0000',
        },
        {
          topic: 'fresh',
          waiting: 1,
          locked: 0,
          lockExpired: 0,
          failed: 0,
          workers: [],
          oldestWaitingSince: '2026-01-01T11:59:00.000+0000',
        },
        {
          topic: 'busy',
          waiting: 4,
          locked: 1,
          lockExpired: 0,
          failed: 0,
          workers: ['w'],
          oldestWaitingSince: '2026-01-01T10:00:00.000+0000',
        },
      ],
      batches: [
        { id: 'b1', type: 'instance-deletion', failedJobs: 1, batchJobDefinitionId: 'jd-b' },
        { id: 'b2', failedJobs: 0 },
      ],
    });
    expect(list).toEqual([
      {
        severity: 'critical',
        code: 'JOBS_OVERDUE',
        message:
          '2 executable jobs have waited longer than 5m (oldest since 2026-01-01T10:00:00.000+0000): is the job executor running?',
        next: 'operate job list --executable --sort-by jobDueDate --sort-order asc --max-results 10',
      },
      {
        severity: 'warning',
        code: 'BATCH_FAILURES',
        message: 'batch b1 (instance-deletion): 1 failed job',
        next: 'operate job list --job-definition-id jd-b --with-exception',
      },
      {
        severity: 'warning',
        code: 'INCIDENTS',
        message: '1 failedJob incident at order/book: plain',
        next: GROUP.next,
      },
      {
        severity: 'warning',
        code: 'INCIDENTS',
        message: '2 failedJob incidents at order/book: PropertyNotFoundException: missingBean',
        next: GROUP.next,
      },
      {
        severity: 'warning',
        code: 'LOCK_EXPIRED',
        message:
          'topic mail: 1 task with an expired lock (the oldest since 2026-01-01T11:30:00.000+0000): a worker crashed or exceeded its lock',
        next: 'operate external-task list --topic-name mail --not-locked --with-retries-left',
      },
      {
        severity: 'warning',
        code: 'NO_WORKER',
        message:
          'topic mail: 3 tasks wait since 2026-01-01T11:00:00.000+0000, none is locked: is a worker subscribed?',
        next: 'operate external-task list --topic-name mail --not-locked',
      },
    ]);
    expect(engineStatus(list)).toBe('critical');
    expect(findings({ ...QUIET, jobs: { executable: 1, overdue: 1 } })[0]?.message).toBe(
      '1 executable job has waited longer than 5m: is the job executor running?',
    );
  });
});

describe('checkFailure', () => {
  const warning = findings({ ...QUIET, incidents: [GROUP] });

  it('fails at the --fail-on level with the first next command as hint', () => {
    expect(checkFailure('warning', warning, 'warning')).toMatchObject({
      code: 'CHECK_FAILED',
      message: 'Engine status is warning (1 finding)',
      details: {
        hint: `Start with: ${GROUP.next}`,
        data: { status: 'warning', findings: warning },
      },
    });
    expect(checkFailure('warning', warning, 'critical')).toBeUndefined();
    expect(checkFailure('critical', warning, 'critical')).toBeDefined();
    expect(checkFailure('warning', warning, undefined)).toBeUndefined();
    expect(
      checkFailure('warning', [{ severity: 'warning', code: 'X', message: 'm' }], 'warning')
        ?.details.hint,
    ).toBe('The findings say what is wrong.');
  });
});

describe('finding rules at their limits', () => {
  const topic = {
    topic: 'pay',
    waiting: 1,
    locked: 0,
    lockExpired: 0,
    failed: 0,
    workers: [],
    oldestWaitingSince: '2026-01-01T11:00:00.000+0000',
  };

  it('reports waiting topics only without locks and older than the threshold', () => {
    const codes = (overrides: Partial<typeof topic>) =>
      findings({ ...QUIET, externalTasks: [{ ...topic, ...overrides }] }).map(
        (finding) => finding.code,
      );
    expect(codes({})).toEqual(['NO_WORKER']);
    expect(codes({ waiting: 0 })).toEqual([]);
    expect(codes({ locked: 1 })).toEqual([]);
    expect(codes({ oldestWaitingSince: '2026-01-01T11:55:00.000+0000' })).toEqual([]);
    expect(codes({ oldestWaitingSince: '2026-01-01T11:55:00.001+0000' })).toEqual([]);
    expect(codes({ oldestWaitingSince: '2026-01-01T11:54:59.999+0000' })).toEqual(['NO_WORKER']);
    const { oldestWaitingSince: _o, ...noTime } = topic;
    expect(findings({ ...QUIET, externalTasks: [noTime] })).toEqual([]);
    expect(findings({ ...QUIET, externalTasks: [{ ...topic, waiting: 2 }] })[0]?.message).toBe(
      'topic pay: 2 tasks wait since 2026-01-01T11:00:00.000+0000, none is locked: is a worker subscribed?',
    );
  });

  it('reports an expired lock only once it expired longer than --stale-after ago', () => {
    const codes = (oldestLockExpiredAt?: string) =>
      findings({
        ...QUIET,
        externalTasks: [
          {
            ...topic,
            waiting: 0,
            lockExpired: 1,
            ...(oldestLockExpiredAt === undefined ? {} : { oldestLockExpiredAt }),
          },
        ],
      }).map((finding) => finding.code);
    // 5 minutes before NOW is the threshold
    expect(codes('2026-01-01T11:54:59.999+0000')).toEqual(['LOCK_EXPIRED']);
    expect(codes('2026-01-01T11:55:00.000+0000')).toEqual([]);
    expect(codes('2026-01-01T11:59:40.000+0000')).toEqual([]);
    expect(codes()).toEqual([]);
  });

  it('names process definition keys without a deployed definition', () => {
    expect(findings({ ...QUIET, unknownKeys: ['nope'] })).toEqual([
      {
        severity: 'warning',
        code: 'UNKNOWN_KEY',
        message: 'process definition key nope is not deployed',
        next: 'operate process-definition list --latest-version --sort-by key --sort-order asc',
      },
    ]);
  });

  it('names the job definition of incidents without a process definition', () => {
    const standalone: IncidentGroup = {
      ...GROUP,
      processDefinitionKey: '',
      activityId: '',
      jobDefinitionId: 'jd-1',
      next: 'operate job list --job-definition-id jd-1 --with-exception',
    };
    expect(findings({ ...QUIET, incidents: [standalone] })[0]?.message).toBe(
      '2 failedJob incidents at job definition jd-1: PropertyNotFoundException: missingBean',
    );
    const { jobDefinitionId: _j, ...unknown } = standalone;
    expect(findings({ ...QUIET, incidents: [unknown] })[0]?.message).toContain(
      'at job definition (unknown):',
    );
  });

  it('names batches without job definition and type with placeholders', () => {
    expect(findings({ ...QUIET, batches: [{ failedJobs: 1 }] })).toEqual([
      {
        severity: 'warning',
        code: 'BATCH_FAILURES',
        message: 'batch  (): 1 failed job',
        next: "operate job list --job-definition-id '<id>' --with-exception",
      },
    ]);
  });

  it('orders critical before warning regardless of code', () => {
    const list = findings({
      ...QUIET,
      jobs: { executable: 1, overdue: 1 },
      batches: [{ id: 'b', type: 't', failedJobs: 2 }],
    });
    expect(list.map((finding) => finding.code)).toEqual(['JOBS_OVERDUE', 'BATCH_FAILURES']);
    expect(list[0]?.message).toBe(
      '1 executable job has waited longer than 5m: is the job executor running?',
    );
    expect(engineStatus(list)).toBe('critical');
  });
});
