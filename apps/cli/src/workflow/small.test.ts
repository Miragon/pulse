import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { BASE_URL, fakeServer } from '../../test/support/fake-fetch.js';
import { basicAuth } from '../auth/basic.js';
import { dryRunOutput, dryRunText } from './dry-run.js';
import { isAdvanceable, itemCommand, nextCommands } from './next.js';
import { endedError, incidentError, jobFailedError, timeoutError } from './outcomes.js';
import {
  amount,
  compareText,
  compareTime,
  countOf,
  definitionKeyOf,
  engineFormat,
  engineTime,
  field,
  num,
  records,
  str,
  yes,
} from './records.js';
import { shellWord } from './shell.js';
import { timelineOf } from './timeline.js';

describe('records', () => {
  it('reads typed properties defensively', () => {
    expect(records([{ a: 1 }, null, 'x', [1]])).toEqual([{ a: 1 }]);
    expect(records('x')).toEqual([]);
    expect([
      str({ a: 'x' }, 'a'),
      str({ a: '' }, 'a'),
      str({ a: 1 }, 'a'),
      str(undefined, 'a'),
    ]).toEqual(['x', undefined, undefined, undefined]);
    expect([num({ a: 1 }, 'a'), num({ a: 3n }, 'a'), num({ a: '1' }, 'a')]).toEqual([
      1,
      3,
      undefined,
    ]);
    expect([yes({ a: true }, 'a'), yes({ a: 'true' }, 'a')]).toEqual([true, false]);
    expect([countOf({ count: 4 }), countOf({}), countOf(null)]).toEqual([4, 0, 0]);
    expect([definitionKeyOf('order:1:x'), definitionKeyOf(''), definitionKeyOf(undefined)]).toEqual(
      ['order', undefined, undefined],
    );
  });

  it('reads and writes engine timestamps', () => {
    expect(engineTime('2024-05-01T10:00:00.000+0200')).toBe(Date.parse('2024-05-01T08:00:00.000Z'));
    expect(engineTime('2024-05-01T08:00:00Z')).toBe(Date.parse('2024-05-01T08:00:00.000Z'));
    expect([engineTime('nope'), engineTime(undefined)]).toEqual([undefined, undefined]);
    expect(engineFormat(Date.parse('2024-05-01T08:00:00.000Z'))).toBe(
      '2024-05-01T08:00:00.000+0000',
    );
    expect([compareText('a', 'b'), compareText('b', 'a'), compareText('a', 'a')]).toEqual([
      -1, 1, 0,
    ]);
    expect([
      compareTime('2024-01-01', '2024-01-02'),
      compareTime('2024-01-02', '2024-01-01'),
      compareTime(undefined, '2024-01-01'),
      compareTime(undefined, undefined),
    ]).toEqual([-1, 1, 1, 0]);
  });
});

describe('shellWord', () => {
  it('quotes only what needs quoting', () => {
    expect(shellWord('order-process_2.v1')).toBe('order-process_2.v1');
    expect(shellWord('my task')).toBe("'my task'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
  });
});

describe('nextCommands', () => {
  const base = { id: 'p1', state: 'ACTIVE' as const, waitingAt: [], incidents: [] };

  it('suggests retry, advance and history in this order, at most 3', () => {
    expect(nextCommands(base, false)).toEqual([]);
    expect(
      nextCommands(
        {
          ...base,
          incidents: [{ id: 'i', type: 'failedExternalTask', activityId: 'a', since: 's' }],
        },
        false,
      ),
    ).toEqual(['operate retry p1']);
    expect(
      nextCommands(
        { ...base, incidents: [{ id: 'i', type: 'custom', activityId: 'a', since: 's' }] },
        false,
      ),
    ).toEqual([]);
    const waits = ['a', 'b', 'c'].map((activityId) => ({
      activityId,
      kind: 'userTask' as const,
      taskId: activityId,
    }));
    expect(
      nextCommands(
        {
          ...base,
          waitingAt: waits,
          incidents: [{ id: 'i', type: 'failedJob', activityId: 'a', since: 's' }],
        },
        false,
      ),
    ).toEqual([
      'operate retry p1',
      'operate advance p1 --activity-id a',
      'operate advance p1 --activity-id b',
    ]);
    expect(nextCommands({ ...base, state: 'EXTERNALLY_TERMINATED' }, false)).toEqual([
      'operate inspect p1 --history',
    ]);
    expect(nextCommands({ ...base, state: 'SUSPENDED' }, false)).toEqual([
      'operate process-instance activate p1',
    ]);
  });

  it('suggests the item command of a multi-instance activity and skips suspended jobs', () => {
    const task = (taskId: string, activityId = 'multi') => ({
      activityId,
      kind: 'userTask' as const,
      taskId,
    });
    expect(nextCommands({ ...base, waitingAt: [task('t1'), task('t2')] }, false)).toEqual([
      'operate task complete t1',
    ]);
    expect(
      nextCommands({ ...base, waitingAt: [task('t1'), task('t2'), task('t3', 'review')] }, false),
    ).toEqual(['operate task complete t1', 'operate advance p1 --activity-id review']);
    const external = (id: string) => ({
      activityId: 'charge',
      kind: 'externalTask' as const,
      externalTaskId: id,
      topic: 't',
    });
    // external tasks need a lock first: no ready item command
    expect(nextCommands({ ...base, waitingAt: [external('e1'), external('e2')] }, false)).toEqual(
      [],
    );
    const suspended = {
      activityId: 'book',
      kind: 'asyncContinuation' as const,
      jobId: 'j1',
      retries: 3,
      suspended: true as const,
    };
    expect(nextCommands({ ...base, waitingAt: [suspended, task('t1', 'review')] }, false)).toEqual([
      'operate advance p1',
    ]);
  });
});

describe('itemCommand', () => {
  it('names the generated command that moves one wait state', () => {
    const at = { activityId: 'a', executionId: 'ex1', eventSubscriptionId: 's1' };
    expect(itemCommand({ ...at, kind: 'message', eventName: 'Paid now' })).toBe(
      "operate execution trigger-event ex1 'Paid now'",
    );
    expect(itemCommand({ ...at, kind: 'signal', eventName: 'go' })).toBe(
      'operate signal throw --name go --execution-id ex1',
    );
    expect(itemCommand({ ...at, kind: 'message' })).toBe("operate execution trigger-event ex1 ''");
    expect(itemCommand({ activityId: 'r', kind: 'other', executionId: 'ex2' })).toBe(
      'operate execution signal ex2',
    );
    expect(
      itemCommand({ activityId: 't', kind: 'timer', jobId: 'j', dueDate: 'd', retries: 1 }),
    ).toBe('operate job execute j');
    expect(itemCommand({ ...at, kind: 'conditional' })).toBeUndefined();
  });
});

describe('timelineOf', () => {
  it('attaches incidents to the last entry of their activity that started before them, else the first', () => {
    const entries = timelineOf(
      [
        {
          activityId: 'book',
          activityType: 'serviceTask',
          startTime: '2026-01-01T00:00:01.000+0000',
        },
        {
          activityId: 'book',
          activityType: 'serviceTask',
          startTime: '2026-01-01T00:00:05.000+0000',
        },
        {
          activityId: 'later',
          activityType: 'serviceTask',
          startTime: '2026-01-01T00:00:09.000+0000',
        },
      ],
      [
        {
          id: 'h2',
          incidentType: 'failedJob',
          activityId: 'book',
          createTime: '2026-01-01T00:00:06.000+0000',
          open: true,
        },
        {
          id: 'h1',
          incidentType: 'failedJob',
          activityId: 'book',
          createTime: '2026-01-01T00:00:02.000+0000',
          deleted: true,
        },
        {
          id: 'h3',
          incidentType: 'failedJob',
          activityId: 'later',
          createTime: '2026-01-01T00:00:03.000+0000',
        },
        {
          id: 'h4',
          incidentType: 'failedJob',
          activityId: 'nowhere',
          createTime: '2026-01-01T00:00:03.000+0000',
        },
      ],
    );
    expect(entries.map((entry) => entry.incidents?.map((incident) => incident.state))).toEqual([
      ['deleted'],
      ['open'],
      ['resolved'],
    ]);
  });
});

describe('outcomes', () => {
  it('builds the errors of exit code 9 with their data', () => {
    expect(incidentError('p1', []).message).toBe('Process instance p1 has an incident');
    const two = [
      { id: 'a', type: 'failedJob', activityId: 'x', message: 'm', since: 's' },
      { id: 'b', type: 'failedJob', activityId: 'y', since: 's' },
    ];
    expect(incidentError('p1', two)).toMatchObject({
      code: 'INCIDENT',
      exitCode: 9,
      message: 'Process instance p1 has 2 incidents, the first: failedJob at x: m',
    });
    expect(incidentError('p1', [two[1]!]).message).toBe(
      'Process instance p1 has an incident: failedJob at y: ',
    );
    // the view on stdout has message and root cause: the error names the incidents only
    expect(
      incidentError('p1', [
        { ...two[0]!, rootCause: 'r', processInstanceId: 'c1', stacktrace: ['at x'] },
      ]).details.data,
    ).toEqual({
      incidents: [{ id: 'a', type: 'failedJob', activityId: 'x', processInstanceId: 'c1' }],
    });
    expect(
      timeoutError('p1', ['task', 'ended'], 120_000, { elapsedMs: 120_000, polls: 63 }),
    ).toMatchObject({
      code: 'WAIT_TIMEOUT',
      message: 'Timed out after 2m waiting until task or ended (process instance p1)',
    });
    expect(endedError('p1', ['task'], 'COMPLETED')).toMatchObject({
      code: 'INSTANCE_ENDED',
      details: { hint: '`operate inspect p1 --history` shows the path it took.' },
    });
    const failures = [
      { jobId: 'j1', message: 'boom', rootCause: 'r' },
      { jobId: 'j2', message: 'x', rootCause: 'y', processInstanceId: 'p2' },
    ];
    expect(jobFailedError(failures)).toMatchObject({
      code: 'JOB_FAILED',
      message: 'Job j1 failed: boom (and 1 more)',
      details: {
        hint: '`operate inspect <id> --stacktrace` shows the stacktrace; fix the cause, then retry.',
      },
    });
    expect(jobFailedError([]).message).toBe('Job failed');
  });
});

describe('dryRunOutput', () => {
  it('previews the planned requests with masked secrets and curl lines', async () => {
    const auth = basicAuth({
      type: 'basic',
      username: 'demo',
      password: 'secret',
      sources: { username: 'flag', password: 'flag' },
    });
    const port = portOf(fakeServer().fetch, { auth });
    const { view, notes } = await dryRunOutput(
      {
        plan: { a: 1 },
        requests: [
          { operationId: 'getRestAPIVersion', input: { pathArgs: [], query: {} } },
          {
            summary: 'complete user task t1',
            operationId: 'complete',
            input: { pathArgs: ['t1'], query: {}, body: {} },
          },
        ],
      },
      port,
      false,
    );
    expect(notes).toEqual([]);
    expect(view.plan).toEqual({ a: 1 });
    expect(view.requests[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/version`,
      headers: { Authorization: 'Basic ***' },
    });
    expect(view.requests[1]).toMatchObject({
      summary: 'complete user task t1',
      method: 'POST',
      body: {},
    });
    expect(dryRunText(view)).toBe(
      `${view.requests[0]?.curl}\n# complete user task t1\n${view.requests[1]?.curl}\n`,
    );
    expect(await dryRunOutput({ requests: [] }, port, true)).toEqual({
      view: { requests: [] },
      notes: [],
    });
    const revealed = await dryRunOutput(
      { requests: [{ operationId: 'getRestAPIVersion', input: { pathArgs: [], query: {} } }] },
      port,
      true,
    );
    expect(JSON.stringify(revealed.view)).toContain('Basic ZGVtbzpzZWNyZXQ=');
  });

  it('collects the note of the auth preview once, e.g. a missing OAuth login', async () => {
    const note = 'Not logged in with OAuth (profile "sso")';
    const auth = {
      type: 'oauth',
      headers: () => Promise.resolve({}),
      preview: () => Promise.resolve({ headers: {}, note }),
    };
    const version = { operationId: 'getRestAPIVersion', input: { pathArgs: [], query: {} } };
    const { view, notes } = await dryRunOutput(
      { requests: [version, version] },
      portOf(fakeServer().fetch, { auth }),
      false,
    );
    expect(notes).toEqual([note]);
    expect(view.requests).toHaveLength(2);
    expect(view.requests[0]?.headers).not.toHaveProperty('Authorization');
  });
});

describe('record helpers without a record', () => {
  it('are false, missing or zero for undefined', () => {
    expect([yes(undefined, 'a'), amount(undefined, 'a'), field(undefined, 'a')]).toEqual([
      false,
      0,
      '',
    ]);
  });
});

describe('nextCommands details', () => {
  const base = { id: 'p1', state: 'ACTIVE' as const, waitingAt: [], incidents: [] };

  it('advances signals and receive tasks only, skips empty activity ids and caps at 3', () => {
    const signal = {
      activityId: 's',
      kind: 'signal' as const,
      eventSubscriptionId: 'e',
      executionId: 'x',
    };
    expect(nextCommands({ ...base, waitingAt: [signal] }, false)).toEqual(['operate advance p1']);
    const odd = {
      activityId: 'c',
      kind: 'conditional' as const,
      activityType: 'receiveTask',
      eventSubscriptionId: 'e',
      executionId: 'x',
    };
    expect(isAdvanceable(odd)).toBe(false);
    const unnamed = [
      { activityId: '', kind: 'userTask' as const, taskId: 't1' },
      { activityId: 'a', kind: 'userTask' as const, taskId: 't2' },
    ];
    expect(nextCommands({ ...base, waitingAt: unnamed }, false)).toEqual([
      'operate advance p1 --activity-id a',
    ]);
    const many = ['a', 'b'].map((activityId) => ({
      activityId,
      kind: 'userTask' as const,
      taskId: activityId,
    }));
    expect(
      nextCommands(
        {
          ...base,
          state: 'COMPLETED',
          waitingAt: many,
          incidents: [{ id: 'i', type: 'failedJob', activityId: 'a', since: 's' }],
        },
        false,
      ),
    ).toEqual([
      'operate retry p1',
      'operate advance p1 --activity-id a',
      'operate advance p1 --activity-id b',
    ]);
  });
});

describe('outcome texts', () => {
  it('name the fix and join several conditions with or', () => {
    expect(incidentError('p1', []).details.hint).toBe(
      'Fix the cause, then run `operate retry p1`; --no-fail-on-incident keeps waiting despite incidents.',
    );
    expect(timeoutError('p1', ['idle'], 1000, { elapsedMs: 1000, polls: 4 }).details.hint).toBe(
      'The job executor may be backing off (up to 60 s on an idle engine): raise --wait-timeout, execute due jobs with `operate wait p1 --execute-jobs`, or run `operate status` to see overdue jobs.',
    );
    const message = {
      activityId: 'paid',
      kind: 'message' as const,
      eventSubscriptionId: 's',
      executionId: 'e',
    };
    const progress = { elapsedMs: 1000, polls: 4 };
    expect(
      timeoutError('p1', ['task'], 1000, { ...progress, idleAt: [message] }).details.hint,
    ).toBe(
      'No job is due: the instance rests at paid (message). Move it with `operate advance p1`, or check the --until condition against `operate inspect p1`.',
    );
    const four = ['a', 'b', 'c', 'd'].map((activityId) => ({ ...message, activityId }));
    expect(
      timeoutError('p1', ['task'], 1000, { ...progress, idleAt: four }).details.hint,
    ).toContain('rests at a (message), b (message), c (message), ...');
    expect(timeoutError('p1', ['idle'], 1000, { ...progress, idleAt: [] }).details.hint).toMatch(
      /^The job executor may be backing off/,
    );
    // advance refuses a suspended job: the hint names the activation instead
    const suspended = {
      activityId: 'work',
      kind: 'asyncContinuation' as const,
      jobId: 'j1',
      retries: 3,
      suspended: true as const,
    };
    expect(
      timeoutError('p1', ['task'], 1000, { ...progress, idleAt: [suspended] }).details.hint,
    ).toBe(
      'No job is due: the instance rests at work (asyncContinuation, suspended). Activate the suspended job with `operate job activate j1`, or check the --until condition against `operate inspect p1`.',
    );
    expect(
      timeoutError('p1', ['task'], 1000, { ...progress, idleAt: [suspended, message] }).details
        .hint,
    ).toContain('Move it with `operate advance p1`');
    expect(endedError('p1', ['task', 'activity:x'], 'COMPLETED').message).toBe(
      'Process instance p1 ended (COMPLETED) before reaching task or activity:x',
    );
  });
});
