import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkRetryCount,
  executeWrite,
  missingRoots,
  planRetry,
  retriesWrite,
  retryEffect,
  retryMode,
  retryPlanView,
} from './retry-plan.js';

function incident(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    configuration: `job-${id}`,
    activityId: 'book',
    processInstanceId: 'p1',
    incidentTimestamp: '2026-01-01T00:00:00.000+0000',
    incidentMessage: 'm',
    ...overrides,
  };
}

describe('retryMode and retryEffect', () => {
  it.each([
    [{ id: 'p', latest: false }, [], 'instance', 'write'],
    [{ businessKey: 'B', processDefinitionKey: 'k', latest: false }, [], 'instance', 'write'],
    [{ processDefinitionKey: 'k', latest: true }, [], 'instance', 'write'],
    [{ latest: false }, ['i1'], 'incidents', 'write'],
    [{ processDefinitionKey: 'k', latest: false }, [], 'definition', 'bulk'],
  ] as const)('%j with incidents %j is %s mode (%s)', (selection, incidents, mode, effect) => {
    expect(retryMode(selection, incidents)).toBe(mode);
    expect(retryEffect(mode)).toBe(effect);
  });

  it('refuses mixed and missing selections listing the modes', () => {
    expect(() => retryMode({ id: 'p', latest: false }, ['i1'])).toThrow(
      '--incident excludes the process instance id, --business-key, --process-definition-key and --latest',
    );
    expect(() => retryMode({ processDefinitionKey: 'k', latest: false }, ['i1'])).toThrow(
      '--incident excludes',
    );
    expect(() => retryMode({ latest: false }, [])).toThrow('Select what to retry');
  });
});

describe('planRetry', () => {
  it('replaces propagated incidents by their root cause, deduplicated and ordered by time and id', () => {
    const incidents = [
      incident('b', { incidentTimestamp: '2026-01-01T00:00:02.000+0000' }),
      incident('p1', { rootCauseIncidentId: 'a', configuration: null }),
      incident('p2', { rootCauseIncidentId: 'a', configuration: null }),
      incident('a', { incidentTimestamp: '2026-01-01T00:00:01.000+0000', processInstanceId: 'c1' }),
      incident('orphan', { rootCauseIncidentId: 'missing' }),
    ];
    expect(planRetry(incidents, {}).map((entry) => entry.incidentId)).toEqual(['a', 'b']);
    expect(missingRoots(incidents)).toEqual(['missing']);
  });

  it('decides the action by type and filters the root causes by activity and type', () => {
    const incidents = [
      incident('j'),
      incident('e', {
        incidentType: 'failedExternalTask',
        configuration: 'et-1',
        activityId: 'charge',
      }),
      incident('c', { incidentType: 'customIncident', configuration: 'x' }),
      incident('n', { configuration: null }),
    ];
    expect(
      planRetry(incidents, {}).map((entry) => [
        entry.incidentId,
        entry.action,
        entry.jobId ?? entry.externalTaskId,
      ]),
    ).toEqual([
      ['c', 'skip', undefined],
      ['e', 'externalTask', 'et-1'],
      ['j', 'job', 'job-j'],
      ['n', 'skip', undefined],
    ]);
    expect(planRetry(incidents, { activityId: 'charge' }).map((entry) => entry.incidentId)).toEqual(
      ['e'],
    );
    expect(
      planRetry(incidents, { incidentType: 'failedJob' }).map((entry) => entry.incidentId),
    ).toEqual(['j', 'n']);
  });

  it('lists every root incident once (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 })), {
          maxLength: 30,
        }),
        (pairs) => {
          const roots = [...new Set(pairs.map(([root]) => root))];
          const incidents = [
            ...roots.map((root) => incident(`r${root}`)),
            ...pairs.map(([root, n], index) =>
              incident(`x${index}-${n}`, { rootCauseIncidentId: `r${root}` }),
            ),
          ];
          const planned = planRetry(incidents, {}).map((entry) => entry.incidentId);
          expect(planned.toSorted()).toEqual(roots.map((root) => `r${root}`).toSorted());
        },
      ),
    );
  });
});

describe('checkRetryCount', () => {
  const entries = planRetry(
    Array.from({ length: 1001 }, (_, index) => incident(`i${index}`)),
    {},
  );

  it('refuses more than 1000 retries and truncated lists before any write', () => {
    expect(() => {
      checkRetryCount(entries, false, 'payment');
    }).toThrow('More than 1000 incidents to retry; operate retries them one by one');
    expect(() => {
      checkRetryCount([], true, undefined);
    }).toThrow(/^More than 1000/);
    try {
      checkRetryCount(entries, false, 'payment');
    } catch (error) {
      expect((error as { details: { hint: string } }).details.hint).toContain(
        '"processDefinitionKey":"payment"',
      );
    }
    expect(() => {
      checkRetryCount(entries.slice(0, 1000), false, undefined);
    }).not.toThrow();
  });
});

describe('writes and plan', () => {
  it('builds the retries and execute requests per entry', () => {
    const [job, external, skipped] = planRetry(
      [
        incident('j', { incidentTimestamp: '2026-01-01T00:00:01.000+0000' }),
        incident('e', {
          incidentType: 'failedExternalTask',
          configuration: 'et-1',
          incidentTimestamp: '2026-01-01T00:00:02.000+0000',
        }),
        incident('s', { incidentType: 'x', incidentTimestamp: '2026-01-01T00:00:03.000+0000' }),
      ],
      {},
    );
    expect(job && retriesWrite(job, 2)).toEqual({
      summary: 'set the retries of job job-j to 2',
      operationId: 'setJobRetries',
      input: { pathArgs: ['job-j'], query: {}, body: { retries: 2 } },
    });
    expect(external && retriesWrite(external, 1)).toMatchObject({
      operationId: 'setExternalTaskResourceRetries',
      input: { pathArgs: ['et-1'] },
    });
    expect(skipped && retriesWrite(skipped, 1)).toBeUndefined();
    expect(job && executeWrite(job)).toEqual({
      summary: 'execute job job-j',
      operationId: 'executeJob',
      input: { pathArgs: ['job-j'], query: {} },
    });
    expect(external && executeWrite(external)).toBeUndefined();
  });

  it('summarizes the plan of a dry-run', () => {
    const entries = planRetry([incident('j'), incident('s', { incidentType: 'x' })], {});
    expect(retryPlanView('definition', entries)).toEqual({
      mode: 'definition',
      incidents: 2,
      jobs: 1,
      externalTasks: 0,
      skipped: [{ incidentId: 's', type: 'x', next: 'operate incident resolve s --yes' }],
    });
  });
});

describe('retry plan details', () => {
  it('names the modes in the hint of a missing selection', () => {
    try {
      retryMode({ latest: false }, []);
      expect.unreachable();
    } catch (error) {
      expect((error as { details: { hint: string } }).details.hint).toBe(
        'Select what to retry: a process instance (id, --business-key, or --process-definition-key with --latest), incidents (--incident <id>), or every incident of a process definition (--process-definition-key <key>).',
      );
    }
  });

  it('lists missing root causes once, sorted, ignoring loaded ones and records without root', () => {
    expect(
      missingRoots([
        incident('a', { rootCauseIncidentId: 'z' }),
        incident('b', { rootCauseIncidentId: 'y' }),
        incident('c', { rootCauseIncidentId: 'z' }),
        incident('d', { rootCauseIncidentId: 'a' }),
        { id: 'e' },
      ]),
    ).toEqual(['y', 'z']);
  });

  it('keeps only loaded roots and fills missing fields', () => {
    expect(
      planRetry(
        [
          incident('p', { rootCauseIncidentId: 'gone' }),
          incident('q', { rootCauseIncidentId: 'p' }),
          { rootCauseIncidentId: 'x' },
          {},
        ],
        {},
      ),
    ).toEqual([]);
    expect(planRetry([{ id: 'r', rootCauseIncidentId: 'r', configuration: 'c' }], {})).toEqual([
      { incidentId: 'r', type: '', activityId: '', processInstanceId: '', action: 'skip' },
    ]);
    expect(planRetry([incident('n', { configuration: undefined })], {})).toEqual([
      {
        incidentId: 'n',
        type: 'failedJob',
        activityId: 'book',
        processInstanceId: 'p1',
        message: 'm',
        action: 'skip',
      },
    ]);
  });

  it('counts only retryable entries against the limit and names a placeholder key', () => {
    const skipped = planRetry(
      Array.from({ length: 1001 }, (_, index) => incident(`s${index}`, { incidentType: 'x' })),
      {},
    );
    expect(() => {
      checkRetryCount(skipped, false, undefined);
    }).not.toThrow();
    try {
      checkRetryCount([], true, undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as { details: { hint: string } }).details.hint).toBe(
        'Set the retries asynchronously instead: `operate job set-retries-async --body \'{"jobQuery":{"processDefinitionKey":"<key>","noRetriesLeft":true},"retries":1}\' --yes` and `operate external-task set-retries-async`.',
      );
    }
  });

  it('names external task writes and counts external tasks in the plan', () => {
    const [external] = planRetry(
      [incident('e', { incidentType: 'failedExternalTask', configuration: 'et-1' })],
      {},
    );
    expect(external && retriesWrite(external, 3)).toEqual({
      summary: 'set the retries of external task et-1 to 3',
      operationId: 'setExternalTaskResourceRetries',
      input: { pathArgs: ['et-1'], query: {}, body: { retries: 3 } },
    });
    expect(retryPlanView('instance', external === undefined ? [] : [external])).toEqual({
      mode: 'instance',
      incidents: 1,
      jobs: 0,
      externalTasks: 1,
      skipped: [],
    });
  });
});

describe('planRetry ties', () => {
  it('orders equally old incidents by id in any input order', () => {
    for (const ids of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const entries = planRetry(
        ids.map((id) => incident(id, { incidentTimestamp: '2026-01-01T00:00:00.000+0000' })),
        {},
      );
      expect(entries.map((entry) => entry.incidentId)).toEqual(['a', 'b']);
    }
  });
});
