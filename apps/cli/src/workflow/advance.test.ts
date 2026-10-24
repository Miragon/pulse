import { describe, expect, it } from 'vitest';
import { depsOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json, noContent } from '../../test/support/fake-fetch.js';
import {
  activity,
  activityTree,
  chargeStage,
  P,
  PARENT_DEF,
  runtimeDto,
  historyDto,
  DEFINITIONS,
  JOB_DEFINITIONS,
} from '../../test/support/workflow-fixture.js';
import { WorkflowEngine } from '../../test/support/workflow-engine.js';
import { advance, type AdvanceOptions } from './advance.js';

const BASE: AdvanceOptions = {
  selection: { id: P, latest: false },
  variablesShown: false,
  dryRun: false,
};

/** The fixture waiting at the external task `charge`, with configurable lock and write answers. */
function chargeEngine(task: Record<string, unknown>, complete: () => Response = noContent) {
  const data = chargeStage();
  let completed = false;
  return fakeServer()
    .on('GET', `/process-instance/${P}`, () =>
      completed ? engineError(404, 'InvalidRequestException', 'ended') : json(runtimeDto),
    )
    .on('GET', `/history/process-instance/${P}`, () =>
      json(completed ? { ...historyDto, state: 'COMPLETED' } : historyDto),
    )
    .on('GET', '/process-instance', json([]))
    .on(
      'GET',
      `/process-instance/${P}/activity-instances`,
      json(activityTree(P, PARENT_DEF, [activity('charge:ai-3', 'charge', 'serviceTask', [P])])),
    )
    .on('GET', '/incident', json([]))
    .on('GET', '/event-subscription', json([]))
    .on('GET', '/task', json([]))
    .on('GET', '/external-task', json([{ ...data.externalTasks[0], ...task }]))
    .on('GET', '/job', json([]))
    .on('GET', '/process-definition', json(DEFINITIONS))
    .on('GET', '/job-definition', json(JOB_DEFINITIONS))
    .on('POST', '/external-task/et-1/lock', noContent())
    .on('POST', '/external-task/et-1/complete', () => {
      const response = complete();
      completed = response.status < 300;
      return response;
    })
    .on('POST', '/external-task/et-1/unlock', noContent())
    .on('POST', '/external-task/et-1/failure', noContent());
}

describe('advance', () => {
  it('keeps the other options of the command line in the ready commands of several places', async () => {
    const [task] = chargeStage().externalTasks;
    const refund = { ...task, id: 'et-2', activityId: 'refund', activityInstanceId: 'refund:ai-4' };
    const server = chargeEngine({})
      .on('GET', '/external-task', json([task, refund]))
      .on(
        'GET',
        `/process-instance/${P}/activity-instances`,
        json(
          activityTree(P, PARENT_DEF, [
            activity('charge:ai-3', 'charge', 'serviceTask', [P]),
            activity('refund:ai-4', 'refund', 'serviceTask', [P]),
          ]),
        ),
      );
    await expect(
      advance(depsOf(server.fetch), {
        ...BASE,
        selection: { ...BASE.selection, options: ['--var', 'charged=true', '--wait'] },
      }),
    ).rejects.toMatchObject({
      code: 'USAGE',
      details: {
        hint: `Choose one: operate advance ${P} --activity-id charge --var charged=true --wait, operate advance ${P} --activity-id refund --var charged=true --wait.`,
      },
    });
  });

  it('locks and completes an external task as worker operate', async () => {
    const server = chargeEngine({});
    const result = await advance(depsOf(server.fetch), {
      ...BASE,
      variables: { charged: { value: true, type: 'Boolean' } },
    });
    expect(result).toMatchObject({
      kind: 'view',
      view: {
        advanced: {
          processInstanceId: P,
          activityId: 'charge',
          kind: 'externalTask',
          id: 'et-1',
          via: ['POST /external-task/et-1/lock', 'POST /external-task/et-1/complete'],
        },
        instance: { state: 'COMPLETED' },
      },
    });
    const writes = server.requests.filter((request) => request.method === 'POST');
    const bodies = writes.map((request) => [
      request.path,
      JSON.parse(request.body as string) as unknown,
    ]);
    expect(bodies).toEqual([
      ['/external-task/et-1/lock', { workerId: 'operate', lockDuration: 60000 }],
      [
        '/external-task/et-1/complete',
        { workerId: 'operate', variables: { charged: { value: true, type: 'Boolean' } } },
      ],
    ]);
  });

  it('unlocks the task (best effort) and reports the original error when completing fails', async () => {
    const server = chargeEngine({}, () =>
      engineError(500, 'ProcessEngineException', 'listener failed'),
    );
    await expect(advance(depsOf(server.fetch), BASE)).rejects.toMatchObject({
      code: 'HTTP_SERVER_ERROR',
      message: 'HTTP 500 Internal Server Error: listener failed',
    });
    expect(server.requests.map((request) => `${request.method} ${request.path}`)).toContain(
      'POST /external-task/et-1/unlock',
    );
    const unlockFails = chargeEngine({}, () => engineError(400, 'RestException', 'bad')).on(
      'POST',
      '/external-task/et-1/unlock',
      engineError(500, 'X', 'y'),
    );
    await expect(advance(depsOf(unlockFails.fetch), BASE)).rejects.toMatchObject({
      code: 'HTTP_CLIENT_ERROR',
    });
  });

  it('refuses a lock of another worker before any write', async () => {
    const server = chargeEngine({
      workerId: 'worker-1',
      lockExpirationTime: '2999-01-01T00:00:00.000+0000',
    });
    await expect(advance(depsOf(server.fetch), BASE)).rejects.toMatchObject({
      message: 'External task et-1 is locked by worker worker-1 until 2999-01-01T00:00:00.000+0000',
    });
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('previews the writes with --dry-run after sending only reads', async () => {
    const server = chargeEngine({});
    const result = await advance(depsOf(server.fetch), {
      ...BASE,
      dryRun: true,
      fail: 'Card declined',
    });
    expect(result).toMatchObject({
      kind: 'dry-run',
      plan: { processInstanceId: P, activityId: 'charge', kind: 'externalTask', id: 'et-1' },
      requests: [
        { operationId: 'lock' },
        {
          operationId: 'handleFailure',
          input: { body: { errorMessage: 'Card declined', retries: 0 } },
        },
      ],
    });
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('reports the executor of a job that was already gone and skips --wait after a failed job', async () => {
    const engine = new WorkflowEngine('book');
    engine.attempts = 1;
    const result = await advance(depsOf(engine.fetch), {
      ...BASE,
      wait: {
        conditions: [{ kind: 'ended' }],
        timeoutMs: 1000,
        failOnIncident: true,
        executeJobs: false,
      },
    });
    expect(result).toMatchObject({
      kind: 'view',
      view: {
        advanced: { kind: 'asyncContinuation' },
        instance: { state: 'COMPLETED', waited: { until: 'ended' } },
      },
    });
    const gone = fakeServer()
      .on(
        'POST',
        '/job/job-1/execute',
        engineError(404, 'InvalidRequestException', "No job found with id 'job-1'"),
      )
      .on('GET', '/job/job-1', engineError(404, 'InvalidRequestException', 'gone'));
    const fake = new WorkflowEngine('book');
    const fetch: typeof globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return /\/job\/job-1(\/execute)?$/.test(url)
        ? gone.fetch(input, init)
        : fake.fetch(input, init);
    };
    const executor = await advance(depsOf(fetch), BASE);
    expect(executor).toMatchObject({ view: { advanced: { executedBy: 'jobExecutor' } } });
    const failing = new WorkflowEngine('book');
    const failed = await advance(depsOf(failing.fetch), {
      ...BASE,
      wait: {
        conditions: [{ kind: 'idle' }],
        timeoutMs: 1000,
        failOnIncident: true,
        executeJobs: false,
      },
    });
    expect(failed).toMatchObject({
      failure: { code: 'JOB_FAILED' },
      view: { instance: { incidents: [{ id: 'inc-1' }] } },
    });
    expect('waited' in ((failed.kind === 'view' ? failed.view.instance : undefined) ?? {})).toBe(
      false,
    );
    expect(failing.requests.some((request) => request.path === '/process-instance/count')).toBe(
      false,
    );
  });

  it('keeps the report of the write when reading the instance afterwards fails', async () => {
    let completed = false;
    const server = chargeEngine({}, () => {
      completed = true;
      return noContent();
    }).on('GET', `/process-instance/${P}`, () =>
      completed ? engineError(500, 'ProcessEngineException', 'database gone') : json(runtimeDto),
    );
    const result = await advance(depsOf(server.fetch), BASE);
    expect(result).toEqual({
      kind: 'view',
      view: {
        advanced: expect.objectContaining({
          activityId: 'charge',
          kind: 'externalTask',
        }) as unknown,
      },
      failure: expect.objectContaining({ code: 'HTTP_SERVER_ERROR' }) as unknown,
    });
  });

  it('refuses a suspended job before any write', async () => {
    const engine = new WorkflowEngine('book');
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await engine.fetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/job?') || response.status !== 200) return response;
      const jobs = (await response.json()) as Record<string, unknown>[];
      return json(jobs.map((job) => ({ ...job, suspended: true })));
    };
    await expect(advance(depsOf(fetch), BASE)).rejects.toMatchObject({
      code: 'USAGE',
      message: expect.stringMatching(/is suspended/) as unknown,
    });
    expect(engine.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('does not unlock when the lock itself fails', async () => {
    const server = chargeEngine({}).on(
      'POST',
      '/external-task/et-1/lock',
      engineError(500, 'ProcessEngineException', 'locked meanwhile'),
    );
    await expect(advance(depsOf(server.fetch), BASE)).rejects.toMatchObject({
      message: 'HTTP 500 Internal Server Error: locked meanwhile',
    });
    expect(
      server.requests.filter((request) => request.method === 'POST').map((request) => request.path),
    ).toEqual(['/external-task/et-1/lock']);
  });
});
