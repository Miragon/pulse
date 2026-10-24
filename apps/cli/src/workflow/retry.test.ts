import { describe, expect, it } from 'vitest';
import { depsOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json, noContent, text } from '../../test/support/fake-fetch.js';
import { WorkflowEngine } from '../../test/support/workflow-engine.js';
import { retry, type RetryOptions } from './retry.js';

const BASE: RetryOptions = {
  selection: { id: 'p1', latest: false },
  incidentIds: [],
  filter: {},
  retries: 1,
  executeNow: false,
  variablesShown: false,
  dryRun: false,
};

function incident(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    rootCauseIncidentId: id,
    incidentType: 'failedJob',
    configuration: `job-${id}`,
    activityId: 'book',
    processInstanceId: 'p1',
    incidentTimestamp: `2026-01-01T00:00:0${id.length}.000+0000`,
    ...overrides,
  };
}

/** p1 with the called instance c1: a propagated incident in p1, its root cause in c1 (not listed for c1). */
function treeEngine() {
  return fakeServer()
    .on('GET', '/process-instance/p1', json({ id: 'p1', definitionId: 'k:1:x' }))
    .on('GET', '/process-instance', (request) =>
      json(
        request.query.get('superProcessInstance') === 'p1'
          ? [{ id: 'c1', definitionId: 'c:1:x' }]
          : [],
      ),
    )
    .on('GET', '/incident', (request) =>
      json(
        request.query.get('processInstanceId') === 'p1'
          ? [
              incident('prop', { rootCauseIncidentId: 'root', configuration: null }),
              incident('custom', { incidentType: 'customIncident' }),
            ]
          : [],
      ),
    )
    .on(
      'GET',
      '/incident/root',
      json(incident('root', { processInstanceId: 'c1', configuration: 'job-root' })),
    )
    .on('PUT', '/job/job-root/retries', noContent())
    .on('PUT', '/job/job-custom/retries', noContent());
}

describe('retry', () => {
  it('retries the root causes of the incidents of the instance tree and skips custom incidents', async () => {
    const server = treeEngine();
    const result = await retry(depsOf(server.fetch), BASE);
    expect(result).toEqual({
      kind: 'view',
      view: {
        retried: 1,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        gone: 0,
        incidents: [
          {
            incidentId: 'root',
            type: 'failedJob',
            activityId: 'book',
            processInstanceId: 'c1',
            jobId: 'job-root',
            action: 'retries=1',
            result: 'retried',
          },
          {
            incidentId: 'custom',
            type: 'customIncident',
            activityId: 'book',
            processInstanceId: 'p1',
            action: 'none',
            result: 'skipped',
            next: 'operate incident resolve custom --yes',
          },
        ],
      },
    });
    expect(
      JSON.parse(server.requests.find((request) => request.method === 'PUT')?.body as string),
    ).toEqual({ retries: 1 });
  });

  it('reports resources resolved meanwhile as gone: jobs answer 500 ENGINE-13053, external tasks 404', async () => {
    const gone = fakeServer()
      .on('GET', '/incident/i1', json(incident('i1')))
      .on('GET', '/incident/i22', json(incident('i22', { incidentType: 'failedExternalTask' })))
      .on(
        'PUT',
        '/job/job-i1/retries',
        engineError(500, 'InvalidRequestException', "ENGINE-13053 No job found with id 'job-i1'.'"),
      )
      .on(
        'PUT',
        '/external-task/job-i22/retries',
        engineError(404, 'RestException', 'External task with id job-i22 does not exist'),
      );
    expect(
      await retry(depsOf(gone.fetch), {
        ...BASE,
        selection: { latest: false },
        incidentIds: ['i1', 'i22'],
      }),
    ).toEqual({
      kind: 'view',
      view: expect.objectContaining({
        retried: 0,
        gone: 2,
        incidents: [
          expect.objectContaining({ incidentId: 'i1', result: 'gone' }),
          expect.objectContaining({ incidentId: 'i22', result: 'gone' }),
        ],
      }) as unknown,
    });
  });

  it('reports every entry when a retry fails, then that error', async () => {
    const broken = fakeServer()
      .on('GET', '/incident/i1', json(incident('i1')))
      .on('GET', '/incident/i22', json(incident('i22')))
      .on('PUT', '/job/job-i1/retries', engineError(500, 'ProcessEngineException', 'boom'))
      .on('PUT', '/job/job-i22/retries', noContent())
      .on('POST', '/job/job-i22/execute', noContent());
    const result = await retry(depsOf(broken.fetch), {
      ...BASE,
      selection: { latest: false },
      incidentIds: ['i1', 'i22'],
      executeNow: true,
    });
    expect(result).toMatchObject({
      kind: 'view',
      view: {
        retried: 1,
        errors: 1,
        incidents: [
          { incidentId: 'i1', result: 'error', error: 'HTTP 500 Internal Server Error: boom' },
          { incidentId: 'i22', result: 'succeeded' },
        ],
      },
      failure: { code: 'HTTP_SERVER_ERROR' },
    });
  });

  it('is NOT_FOUND for an instance id that neither runtime nor history knows', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/p1', engineError(404, 'InvalidRequestException', 'gone'))
      .on('GET', '/history/process-instance/p1', engineError(404, 'InvalidRequestException', 'no'));
    await expect(retry(depsOf(server.fetch), BASE)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Process instance p1 does not exist (neither running nor in the history)',
    });
    expect(server.requests.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('is NOT_FOUND for a named incident that does not exist', async () => {
    const server = fakeServer().on(
      'GET',
      '/incident/nope',
      engineError(404, 'InvalidRequestException', 'gone'),
    );
    await expect(
      retry(depsOf(server.fetch), { ...BASE, selection: { latest: false }, incidentIds: ['nope'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Incident nope does not exist' });
  });

  it('executes the retried jobs with --now and reports a job that failed again with JOB_FAILED', async () => {
    const server = fakeServer()
      .on('GET', '/incident/i1', json(incident('i1')))
      .on(
        'GET',
        '/incident/e1',
        json(incident('e1', { incidentType: 'failedExternalTask', configuration: 'et-1' })),
      )
      .on('PUT', '/job/job-i1/retries', noContent())
      .on('PUT', '/external-task/et-1/retries', noContent())
      .on(
        'POST',
        '/job/job-i1/execute',
        engineError(404, 'InvalidRequestException', 'still broken'),
      )
      .on('GET', '/job/job-i1', json({ id: 'job-i1', failedActivityId: 'book' }))
      .on(
        'GET',
        '/job/job-i1/stacktrace',
        text('x.Y: still broken\nCaused by: a.B: root', 'text/plain'),
      );
    const result = await retry(depsOf(server.fetch), {
      ...BASE,
      selection: { latest: false },
      incidentIds: ['i1', 'e1'],
      executeNow: true,
    });
    expect(result).toMatchObject({
      view: {
        retried: 2,
        succeeded: 0,
        failed: 1,
        incidents: [
          { incidentId: 'e1', action: 'retries=1', result: 'retried' },
          {
            incidentId: 'i1',
            action: 'retries=1, execute',
            result: 'failed',
            rootCause: 'B: root',
            next: 'operate inspect p1 --stacktrace',
          },
        ],
      },
      failure: {
        code: 'JOB_FAILED',
        message: 'Job job-i1 at book failed: still broken',
        details: { data: { failures: [{ incidentId: 'i1', result: 'failed' }] } },
      },
    });
  });

  it('loads every incident of a definition and refuses more than 1000', async () => {
    const server = fakeServer()
      .on('GET', '/incident', json([incident('i1')]))
      .on('PUT', '/job/job-i1/retries', noContent());
    const result = await retry(depsOf(server.fetch), {
      ...BASE,
      selection: { processDefinitionKey: 'k', latest: false },
      filter: { activityId: 'book', incidentType: 'failedJob' },
    });
    expect(result).toMatchObject({ view: { retried: 1 } });
    const query = server.requests[0]?.query;
    expect([
      query?.get('processDefinitionKeyIn'),
      query?.get('activityId'),
      query?.get('incidentType'),
      query?.get('maxResults'),
    ]).toEqual(['k', 'book', 'failedJob', '500']);
    const many = Array.from({ length: 1001 }, (_, index) => incident(`m${index}`));
    const huge = fakeServer().on('GET', '/incident', (request) => {
      const first = Number(request.query.get('firstResult'));
      return json(many.slice(first, first + Number(request.query.get('maxResults'))));
    });
    await expect(
      retry(depsOf(huge.fetch), {
        ...BASE,
        selection: { processDefinitionKey: 'k', latest: false },
      }),
    ).rejects.toThrow(/^More than 1000 incidents/);
  });

  it('retries nothing for an ended instance', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/p1', engineError(404, 'InvalidRequestException', 'gone'))
      .on('GET', '/history/process-instance/p1', json({ id: 'p1', state: 'COMPLETED' }));
    expect(await retry(depsOf(server.fetch), BASE)).toEqual({
      kind: 'view',
      view: { retried: 0, succeeded: 0, failed: 0, skipped: 0, gone: 0, incidents: [] },
    });
  });
});

describe('retry details', () => {
  const WAIT = {
    conditions: [{ kind: 'task' as const }],
    timeoutMs: 60_000,
    failOnIncident: true,
    executeJobs: false,
  };

  it('names the hint of a missing incident', async () => {
    const server = fakeServer().on(
      'GET',
      '/incident/nope',
      engineError(404, 'InvalidRequestException', 'gone'),
    );
    await expect(
      retry(depsOf(server.fetch), { ...BASE, selection: { latest: false }, incidentIds: ['nope'] }),
    ).rejects.toMatchObject({
      details: {
        hint: 'List the open incidents with `operate incident list`; resolved incidents are gone.',
      },
    });
  });

  it('refuses --wait without a process instance', async () => {
    await expect(
      retry(depsOf(fakeServer().fetch), {
        ...BASE,
        selection: { processDefinitionKey: 'k', latest: false },
        wait: WAIT,
      }),
    ).rejects.toMatchObject({
      code: 'USAGE',
      message: '--wait and --until need a process instance',
      details: {
        hint: 'Select one by id, --business-key, or --process-definition-key with --latest.',
      },
    });
  });

  it('previews only real writes, executions only with --now', async () => {
    const server = fakeServer()
      .on('GET', '/incident/i1', json(incident('i1')))
      .on('GET', '/incident/c1', json(incident('c1', { incidentType: 'custom' })));
    const options = {
      ...BASE,
      selection: { latest: false },
      incidentIds: ['i1', 'c1'],
      dryRun: true,
    };
    const now = await retry(depsOf(server.fetch), { ...options, executeNow: true });
    expect(now.kind === 'dry-run' ? now.requests.map((request) => request.summary) : []).toEqual([
      'set the retries of job job-i1 to 1',
      'execute job job-i1',
    ]);
    const later = await retry(depsOf(server.fetch), options);
    expect(later.kind === 'dry-run' ? later.requests.length : 0).toBe(1);
  });

  it('skips the root cause that cannot be loaded', async () => {
    const server = fakeServer()
      .on('GET', '/incident/p', json(incident('p', { rootCauseIncidentId: 'gone' })))
      .on('GET', '/incident/gone', engineError(404, 'InvalidRequestException', 'gone'));
    expect(
      await retry(depsOf(server.fetch), {
        ...BASE,
        selection: { latest: false },
        incidentIds: ['p'],
      }),
    ).toEqual({
      kind: 'view',
      view: { retried: 0, succeeded: 0, failed: 0, skipped: 0, gone: 0, incidents: [] },
    });
  });

  it('does not wait after a job failed again and names the instance of the entry', async () => {
    const engine = new WorkflowEngine('failed');
    engine.attempts = 0;
    const result = await retry(
      depsOf(engine.fetch, () => {
        engine.tick();
      }),
      { ...BASE, selection: { id: 'pi-1', latest: false }, executeNow: true, wait: WAIT },
    );
    expect(result).toMatchObject({
      kind: 'view',
      view: { failed: 1, instance: { id: 'pi-1', state: 'ACTIVE' } },
      failure: { code: 'JOB_FAILED' },
    });
    const instance = result.kind === 'view' ? result.view.instance : undefined;
    expect(instance).not.toHaveProperty('waited');
    expect(instance).not.toHaveProperty('timeline');
    expect(instance !== undefined && 'incidents' in instance ? instance.incidents[0] : {}).toEqual(
      expect.objectContaining({ id: 'inc-1' }),
    );
    expect(
      instance !== undefined && 'incidents' in instance ? instance.incidents[0] : {},
    ).not.toHaveProperty('stacktrace');
    expect(result.kind === 'view' ? result.failure?.details.hint : '').toContain(
      '`operate inspect pi-1 --stacktrace`',
    );
    expect(engine.requests.some((request) => request.path === '/process-instance/count')).toBe(
      false,
    );
  });

  it('waits after the retries and reports the failure of the wait', async () => {
    const engine = new WorkflowEngine('failed');
    const result = await retry(
      depsOf(engine.fetch, () => {
        engine.tick();
      }),
      { ...BASE, selection: { id: 'pi-1', latest: false }, wait: WAIT, variablesShown: true },
    );
    expect(result).toMatchObject({
      kind: 'view',
      view: { retried: 1, instance: { id: 'pi-1', state: 'COMPLETED' } },
      failure: { code: 'INSTANCE_ENDED' },
    });
    const instance = result.kind === 'view' ? result.view.instance : undefined;
    expect(instance).not.toHaveProperty('timeline');
  });
});
