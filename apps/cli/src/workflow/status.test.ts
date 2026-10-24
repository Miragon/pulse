import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  definitionStatus,
  groupIncidents,
  jobStatus,
  messagePattern,
  topicStatus,
  unknownKeys,
} from './status.js';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

function statistics(
  key: string,
  version: number,
  [instances, failedJobs, incidents]: readonly [number, number, number],
) {
  return {
    id: `${key}:${version}:x`,
    instances,
    failedJobs,
    incidents: incidents === 0 ? [] : [{ incidentType: 'failedJob', incidentCount: incidents }],
    definition: { id: `${key}:${version}:x`, key, version, name: `${key} v${version}` },
  };
}

describe('messagePattern', () => {
  it('masks UUIDs, long hex runs and digit runs', () => {
    expect(
      messagePattern(
        'Job 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002 failed after 3 retries (0123456789abcdef0)',
      ),
    ).toBe('Job # failed after # retries (#)');
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string(), (message) => {
        expect(messagePattern(messagePattern(message))).toBe(messagePattern(message));
      }),
    );
  });
});

describe('definitionStatus', () => {
  const rows = [
    statistics('order', 1, [2, 0, 0]),
    statistics('order', 2, [1, 1, 1]),
    statistics('idle', 1, [0, 0, 0]),
    statistics('busy', 1, [5, 0, 0]),
  ];

  it('sums per key, leaves out idle keys unless named and sorts by incidents, failed jobs, instances', () => {
    expect(definitionStatus(rows, [])).toEqual([
      {
        key: 'order',
        name: 'order v2',
        latestVersion: 2,
        versions: 2,
        instances: 3,
        failedJobs: 1,
        incidents: 1,
      },
      {
        key: 'busy',
        name: 'busy v1',
        latestVersion: 1,
        versions: 1,
        instances: 5,
        failedJobs: 0,
        incidents: 0,
      },
    ]);
    expect(definitionStatus(rows, ['idle']).map((status) => status.key)).toEqual(['idle']);
    expect(definitionStatus([{ id: 'raw:1:x', instances: 1 }], [])).toEqual([
      { key: 'raw', latestVersion: 0, versions: 1, instances: 1, failedJobs: 0, incidents: 0 },
    ]);
  });
});

describe('groupIncidents', () => {
  const incident = (id: string, overrides: Record<string, unknown>) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    activityId: 'book',
    processDefinitionId: 'order:2:x',
    processInstanceId: `p-${id}`,
    incidentMessage: `Job ${id.length}0 failed`,
    incidentTimestamp: '2026-01-01T10:00:00.000+0000',
    ...overrides,
  });

  it('groups root causes by key, activity, type and message pattern, largest first', () => {
    const incidents = [
      incident('a', { incidentTimestamp: '2026-01-01T10:00:01.000+0000' }),
      incident('b', {
        incidentTimestamp: '2026-01-01T10:00:03.000+0000',
        incidentMessage: 'Job 99 failed',
      }),
      incident('c', {
        incidentType: 'failedExternalTask',
        activityId: 'charge',
        processDefinitionId: 'pay:1:x',
      }),
      incident('d', { incidentTimestamp: '2026-01-01T10:00:02.000+0000' }),
      incident('e', { incidentTimestamp: '2026-01-01T10:00:04.000+0000' }),
      incident('prop', { rootCauseIncidentId: 'a' }),
    ];
    const grouped = groupIncidents(incidents, [statistics('order', 2, [1, 1, 1])]);
    expect(grouped.propagated).toBe(1);
    expect(grouped.groups.map(({ newest: _, ...group }) => group)).toEqual([
      {
        processDefinitionKey: 'order',
        activityId: 'book',
        type: 'failedJob',
        message: 'Job 10 failed',
        count: 4,
        firstAt: '2026-01-01T10:00:01.000+0000',
        lastAt: '2026-01-01T10:00:04.000+0000',
        processInstanceIds: ['p-e', 'p-b', 'p-d'],
        next: 'operate retry --process-definition-key order --activity-id book --dry-run',
      },
      {
        processDefinitionKey: 'pay',
        activityId: 'charge',
        type: 'failedExternalTask',
        message: 'Job 10 failed',
        count: 1,
        firstAt: '2026-01-01T10:00:00.000+0000',
        lastAt: '2026-01-01T10:00:00.000+0000',
        processInstanceIds: ['p-c'],
        next: 'operate retry --process-definition-key pay --activity-id charge --dry-run',
      },
    ]);
  });

  it('points custom incidents to incident list, quoting odd values', () => {
    const grouped = groupIncidents(
      [incident('x', { incidentType: 'custom', activityId: 'my task' })],
      [],
    );
    expect(grouped.groups[0]?.next).toBe(
      "operate incident list --process-definition-key-in order --activity-id 'my task'",
    );
  });

  it('is a partition whose counts sum to the number of root incidents (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom('failedJob', 'custom'),
            activity: fc.constantFrom('a', 'b'),
            message: fc.constantFrom('x 1', 'x 22', 'y'),
            root: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (specs) => {
          const incidents = specs.map((spec, index) =>
            incident(`i${index}`, {
              incidentType: spec.type,
              activityId: spec.activity,
              incidentMessage: spec.message,
              rootCauseIncidentId: spec.root ? `i${index}` : 'other',
            }),
          );
          const grouped = groupIncidents(incidents, []);
          const roots = specs.filter((spec) => spec.root).length;
          expect(grouped.groups.reduce((sum, group) => sum + group.count, 0)).toBe(roots);
          expect(grouped.propagated).toBe(specs.length - roots);
        },
      ),
    );
  });
});

describe('topicStatus', () => {
  it('classifies external tasks per topic at a fixed time', () => {
    const tasks = [
      { topicName: 'pay', retries: 0 },
      { topicName: 'pay', lockExpirationTime: '2026-01-01T12:05:00.000+0000', workerId: 'w2' },
      { topicName: 'pay', lockExpirationTime: '2026-01-01T12:05:00.000+0000', workerId: 'w1' },
      { topicName: 'pay', lockExpirationTime: '2026-01-01T11:00:00.000+0000', workerId: 'w0' },
      { topicName: 'mail', createTime: '2026-01-01T09:00:00.000+0000' },
      { topicName: 'mail', createTime: '2026-01-01T08:00:00.000+0000' },
    ];
    expect(topicStatus(tasks, NOW)).toEqual([
      {
        topic: 'mail',
        waiting: 2,
        locked: 0,
        lockExpired: 0,
        failed: 0,
        workers: [],
        oldestWaitingSince: '2026-01-01T08:00:00.000+0000',
      },
      {
        topic: 'pay',
        waiting: 0,
        locked: 2,
        lockExpired: 1,
        failed: 1,
        workers: ['w1', 'w2'],
        oldestLockExpiredAt: '2026-01-01T11:00:00.000+0000',
      },
    ]);
  });

  it('counts a reported failure whose retry is due as waiting since its retry time, not as a crash', () => {
    // the engine keeps the worker after a failure and sets the lock to failure time + retryTimeout
    const tasks = [
      {
        topicName: 'charge',
        workerId: 'operate',
        retries: 2,
        errorMessage: 'PSP timeout',
        lockExpirationTime: '2026-01-01T11:50:00.000+0000',
        createTime: '2026-01-01T10:00:00.000+0000',
      },
      {
        topicName: 'charge',
        workerId: 'w1',
        retries: 1,
        errorMessage: 'backing off',
        lockExpirationTime: '2026-01-01T12:10:00.000+0000',
      },
    ];
    expect(topicStatus(tasks, NOW)).toEqual([
      {
        topic: 'charge',
        waiting: 1,
        locked: 1,
        lockExpired: 0,
        failed: 0,
        workers: ['w1'],
        oldestWaitingSince: '2026-01-01T11:50:00.000+0000',
      },
    ]);
  });
});

describe('incidents outside process definitions', () => {
  const batchIncident = (id: string, jobDefinitionId: string) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    jobDefinitionId,
    incidentMessage: 'NotValidException: nope',
    incidentTimestamp: '2026-01-01T10:00:00.000+0000',
  });

  it('leaves out the failed jobs of batches BATCH_FAILURES reports, and names the job definition of others', () => {
    const grouped = groupIncidents(
      [
        batchIncident('b1', 'jd-batch'),
        batchIncident('b2', 'jd-batch'),
        batchIncident('c1', 'jd-cleanup'),
        { id: 'p1', rootCauseIncidentId: 'b1', jobDefinitionId: 'jd-batch' },
      ],
      [],
      new Set(['jd-batch']),
    );
    expect(grouped.propagated).toBe(1);
    expect(grouped.groups.map(({ newest: _, ...group }) => group)).toEqual([
      {
        processDefinitionKey: '',
        activityId: '',
        jobDefinitionId: 'jd-cleanup',
        type: 'failedJob',
        message: 'NotValidException: nope',
        count: 1,
        firstAt: '2026-01-01T10:00:00.000+0000',
        lastAt: '2026-01-01T10:00:00.000+0000',
        processInstanceIds: [],
        next: 'operate job list --job-definition-id jd-cleanup --with-exception',
      },
    ]);
  });

  it('keeps incidents of different job definitions apart and lists them by type without one', () => {
    const grouped = groupIncidents(
      [
        batchIncident('a', 'jd-1'),
        batchIncident('b', 'jd-2'),
        { ...batchIncident('c', ''), incidentType: 'custom' },
      ],
      [],
    );
    expect(grouped.groups.map((group) => group.next).sort()).toEqual([
      'operate incident list --incident-type custom',
      'operate job list --job-definition-id jd-1 --with-exception',
      'operate job list --job-definition-id jd-2 --with-exception',
    ]);
  });

  it('names keys without any deployed definition', () => {
    expect(unknownKeys([statistics('order', 1, [0, 0, 0])], ['order', 'nope'])).toEqual(['nope']);
    expect(unknownKeys([], [])).toEqual([]);
  });
});

describe('jobStatus', () => {
  it('counts executable jobs ready longer than the threshold as overdue', () => {
    const threshold = NOW - 300_000;
    const jobs = [
      { dueDate: '2026-01-01T11:00:00.000+0000' },
      { createTime: '2026-01-01T10:00:00.000+0000' },
      { dueDate: '2026-01-01T11:59:00.000+0000', createTime: '2026-01-01T09:00:00.000+0000' },
    ];
    expect(jobStatus(7, jobs, threshold)).toEqual({
      executable: 7,
      overdue: 2,
      oldestReadySince: '2026-01-01T10:00:00.000+0000',
    });
    expect(jobStatus(0, [], threshold)).toEqual({ executable: 0, overdue: 0 });
  });
});

describe('status edge cases', () => {
  const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    activityId: 'book',
    processDefinitionId: 'order:1:x',
    incidentMessage: 'boom',
    incidentTimestamp: '2026-01-01T10:00:00.000+0000',
    ...overrides,
  });

  it('sums incident counts of object entries only and keeps keys with any activity', () => {
    const rows = [
      { id: 'inc:1:x', instances: 0, failedJobs: 0, incidents: [{ incidentCount: 2 }, null, 5] },
      { id: 'fail:1:x', instances: 0, failedJobs: 3, incidents: 'none' },
      { id: 'run:1:x', instances: 1, failedJobs: 0 },
      { id: 'zero:1:x', instances: 0, failedJobs: 0, incidents: [{ incidentCount: 0 }, {}] },
    ];
    expect(definitionStatus(rows, []).map((status) => [status.key, status.incidents])).toEqual([
      ['inc', 2],
      ['fail', 0],
      ['run', 0],
    ]);
  });

  it('sorts by incidents, failed jobs, instances, then key', () => {
    const rows = [
      statistics('e', 1, [1, 1, 0]),
      statistics('a', 1, [1, 0, 1]),
      statistics('d', 1, [5, 0, 0]),
      statistics('b', 1, [1, 2, 1]),
      statistics('c', 1, [5, 0, 0]),
      statistics('f', 1, [3, 1, 0]),
    ];
    expect(definitionStatus(rows, []).map((status) => status.key)).toEqual([
      'b',
      'a',
      'f',
      'e',
      'c',
      'd',
    ]);
  });

  it('takes the name and version of the highest version, in any order', () => {
    const rows = [
      statistics('order', 1, [1, 0, 0]),
      statistics('order', 3, [1, 0, 0]),
      statistics('order', 2, [1, 0, 0]),
    ];
    expect(definitionStatus(rows, [])).toMatchObject([
      { key: 'order', name: 'order v3', latestVersion: 3, versions: 3, instances: 3 },
    ]);
  });

  it('finds the key of an incident in the statistics rows, with or without definition object', () => {
    const rows = [
      { id: 'p:1:x', key: 'flat' },
      { id: 'q:1:x', definition: null, key: 'nulled' },
      { id: 'r:1:x', definition: { key: 'nested' } },
      { instances: 1 },
    ];
    const keys = groupIncidents(
      [
        incident('a', { processDefinitionId: 'p:1:x' }),
        incident('b', { processDefinitionId: 'q:1:x' }),
        incident('c', { processDefinitionId: 'r:1:x' }),
        incident('d', { processDefinitionId: 'unknown:1:x' }),
        incident('e', { processDefinitionId: undefined }),
      ],
      rows,
    ).groups.map((group) => group.processDefinitionKey);
    expect(keys.toSorted()).toEqual(['', 'flat', 'nested', 'nulled', 'unknown']);
  });

  it('keeps fields apart in the group key and orders equal groups by last time, then command', () => {
    const grouped = groupIncidents(
      [
        incident('a', { activityId: 'x', incidentType: 'yz' }),
        incident('b', { activityId: 'xy', incidentType: 'z' }),
        incident('c', { activityId: 'late', incidentTimestamp: '2026-01-01T11:00:00.000+0000' }),
      ],
      [],
    );
    expect(grouped.groups.map((group) => [group.activityId, group.type, group.count])).toEqual([
      ['late', 'failedJob', 1],
      ['x', 'yz', 1],
      ['xy', 'z', 1],
    ]);
  });

  it('shows the newest member (ties by id) and lists instance ids once, skipping missing ones', () => {
    const grouped = groupIncidents(
      [
        incident('b', { incidentMessage: 'Job 2 failed', processInstanceId: 'p1' }),
        incident('a', { incidentMessage: 'Job 1 failed', processInstanceId: 'p1' }),
        incident('c', {
          incidentMessage: 'Job 3 failed',
          incidentTimestamp: '2026-01-01T09:00:00.000+0000',
        }),
      ],
      [],
    );
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      message: 'Job 1 failed',
      count: 3,
      firstAt: '2026-01-01T09:00:00.000+0000',
      lastAt: '2026-01-01T10:00:00.000+0000',
      processInstanceIds: ['p1'],
    });
    expect(grouped.groups[0]?.newest).toMatchObject({ id: 'a', processDefinitionKey: 'order' });
  });

  it('counts a lock that expires right now as expired and ignores locked tasks without worker', () => {
    const now = '2026-01-01T12:00:00.000+0000';
    expect(
      topicStatus(
        [
          { topicName: 'pay', lockExpirationTime: now, workerId: 'w0' },
          { topicName: 'pay', lockExpirationTime: '2026-01-01T12:00:01.000+0000' },
          { retries: 0 },
        ],
        NOW,
      ),
    ).toEqual([
      { topic: '', waiting: 0, locked: 0, lockExpired: 0, failed: 1, workers: [] },
      {
        topic: 'pay',
        waiting: 0,
        locked: 1,
        lockExpired: 1,
        failed: 0,
        workers: [],
        oldestLockExpiredAt: now,
      },
    ]);
  });

  it('is not overdue at exactly the threshold or without times', () => {
    const threshold = Date.parse('2026-01-01T11:00:00.000Z');
    expect(
      jobStatus(2, [{ dueDate: '2026-01-01T11:00:00.000+0000' }, { id: 'no-time' }], threshold),
    ).toEqual({ executable: 2, overdue: 0 });
  });
});

describe('status ordering and grouping details', () => {
  const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    activityId: 'book',
    processDefinitionId: 'order:1:x',
    incidentMessage: 'Job 1 failed',
    incidentTimestamp: '2026-01-01T10:00:00.000+0000',
    ...overrides,
  });

  it('shows the member with the smaller id among equally new ones, in any input order', () => {
    for (const order of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const grouped = groupIncidents(
        order.map((id) => incident(id, { incidentMessage: `Job ${id === 'a' ? 1 : 2} failed` })),
        [],
      );
      expect(grouped.groups[0]?.message).toBe('Job 1 failed');
    }
  });

  it('separates groups that differ only in type or message pattern', () => {
    expect(
      groupIncidents([incident('a'), incident('b', { incidentType: 'custom' })], []).groups,
    ).toHaveLength(2);
    expect(
      groupIncidents([incident('a'), incident('b', { incidentMessage: 'Other' })], []).groups,
    ).toHaveLength(2);
    expect(
      groupIncidents([incident('a'), incident('b', { incidentMessage: 'Job 22 failed' })], [])
        .groups,
    ).toHaveLength(1);
  });

  it('puts larger groups first even when a smaller one is newer', () => {
    const grouped = groupIncidents(
      [
        incident('a', { activityId: 'big' }),
        incident('b', { activityId: 'big' }),
        incident('c', { activityId: 'new', incidentTimestamp: '2026-01-01T11:00:00.000+0000' }),
      ],
      [],
    );
    expect(grouped.groups.map((group) => group.activityId)).toEqual(['big', 'new']);
  });

  it('masks a digit run as one mark', () => {
    expect(messagePattern('retried 12 times, 345 left')).toBe('retried # times, # left');
  });
});
