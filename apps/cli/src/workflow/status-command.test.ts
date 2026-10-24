import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { BASE_URL, fakeServer, json, text } from '../../test/support/fake-fetch.js';
import { status, type StatusOptions, statusRequests } from './status-command.js';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const OPTIONS: StatusOptions = {
  keys: [],
  staleAfterMs: 300_000,
  maxGroups: 10,
  dryRun: false,
  engine: { url: 'http://demo:secret@localhost/engine-rest', showSecrets: false },
};

function page(items: readonly unknown[]) {
  return (request: { query: URLSearchParams }) => {
    const first = Number(request.query.get('firstResult') ?? 0);
    return json(
      items.slice(first, first + Number(request.query.get('maxResults') ?? items.length)),
    );
  };
}

function engine(
  overrides: {
    incidents?: unknown[];
    externalTasks?: unknown[];
    staleJobs?: unknown[];
    batches?: unknown[];
  } = {},
) {
  let clock = NOW;
  const server = fakeServer()
    .on('GET', '/version', () => {
      clock += 12;
      return json({ version: '7.24.0' });
    })
    .on(
      'GET',
      '/process-definition/statistics',
      json([
        {
          id: 'order:1:x',
          instances: 1,
          failedJobs: 0,
          incidents: [],
          definition: { id: 'order:1:x', key: 'order', version: 1 },
        },
      ]),
    )
    .on('GET', '/incident', page(overrides.incidents ?? []))
    .on('GET', '/incident/count', json({ count: (overrides.incidents ?? []).length }))
    .on('GET', '/external-task', page(overrides.externalTasks ?? []))
    .on('GET', '/external-task/count', json({ count: (overrides.externalTasks ?? []).length }))
    .on('GET', '/job/count', json({ count: 2 }))
    .on('GET', '/job', json(overrides.staleJobs ?? []))
    .on('GET', '/task/count', json({ count: 4 }))
    .on('GET', '/batch/statistics', json(overrides.batches ?? []))
    .on('GET', '/job/j1/stacktrace', text('x.Y: outer\nCaused by: a.B: inner', 'text/plain'));
  return { server, deps: { port: portOf(server.fetch), now: () => clock } };
}

describe('status', () => {
  it('reports an ok engine with the masked url, latency, definitions, jobs, tasks and batches', async () => {
    const { deps } = engine();
    const result = await status(deps, OPTIONS);
    expect(result).toEqual({
      kind: 'view',
      view: {
        engine: { url: 'http://demo:***@localhost/engine-rest', version: '7.24.0', latencyMs: 12 },
        status: 'ok',
        findings: [],
        definitions: [
          {
            key: 'order',
            latestVersion: 1,
            versions: 1,
            instances: 1,
            failedJobs: 0,
            incidents: 0,
          },
        ],
        incidents: [],
        incidentsTotal: 0,
        propagated: 0,
        externalTasks: [],
        jobs: { executable: 2, overdue: 0 },
        tasks: { open: 4 },
        batches: { running: 0, withFailures: 0 },
      },
    });
  });

  it('loads one root cause per group shown and notes what was capped', async () => {
    const incidents = Array.from({ length: 2001 }, (_, index) => ({
      id: `i${index}`,
      rootCauseIncidentId: `i${index}`,
      incidentType: 'failedJob',
      configuration: 'j1',
      activityId: `a${index % 12}`,
      processDefinitionId: 'order:1:x',
      incidentMessage: 'boom',
      incidentTimestamp: '2026-01-01T10:00:00.000+0000',
    }));
    const tasks = Array.from({ length: 2001 }, () => ({ topicName: 't' }));
    const jobs = Array.from({ length: 1000 }, () => ({ dueDate: '2026-01-01T10:00:00.000+0000' }));
    const { deps, server } = engine({
      incidents,
      externalTasks: tasks,
      staleJobs: jobs,
      batches: [{ id: 'b1', failedJobs: 1 }],
    });
    const result = await status(deps, { ...OPTIONS, maxGroups: 2, failOn: 'critical' });
    if (result.kind !== 'view') throw new Error('expected a view');
    expect(result.view.incidents).toHaveLength(2);
    expect(result.view.incidents[0]?.rootCause).toBe('B: inner');
    expect(result.view.truncated).toEqual([
      'incidents: 2000 of 2001 loaded',
      'externalTasks: 2000 of 2001 loaded',
      'jobs: the first 1000 overdue candidates loaded',
      'incident groups: 2 of 12 shown',
    ]);
    expect(result.view.status).toBe('critical');
    expect(result.view.batches).toEqual({ running: 1, withFailures: 1 });
    expect(result.failure).toMatchObject({ code: 'CHECK_FAILED' });
    expect(server.requests.filter((request) => request.path === '/job/j1/stacktrace')).toHaveLength(
      2,
    );
  });

  it('filters by keys: key lists for incidents and tasks, job requests per key, no batches', async () => {
    const { deps, server } = engine();
    const result = await status(deps, { ...OPTIONS, keys: ['order', 'pay'] });
    expect(result.kind === 'view' ? result.view.batches : 'x').toBeUndefined();
    expect(result.kind === 'view' ? result.view.jobs.executable : 0).toBe(4);
    expect(server.requests.some((request) => request.path === '/batch/statistics')).toBe(false);
    expect(
      server.requests
        .filter((request) => request.path === '/job/count')
        .map((request) => request.query.get('processDefinitionKey')),
    ).toEqual(['order', 'pay']);
    expect(
      server.requests
        .find((request) => request.path === '/task/count')
        ?.query.get('processDefinitionKeyIn'),
    ).toBe('order,pay');
  });

  it('previews round 1 with --dry-run, the job filter in the engine format', async () => {
    const { deps, server } = engine();
    const result = await status(deps, { ...OPTIONS, dryRun: true });
    expect(server.requests).toEqual([]);
    expect(result.kind === 'dry-run' ? result.requests.length : 0).toBe(10);
    const jobs = statusRequests(OPTIONS, NOW).find((request) => request.operationId === 'getJobs');
    // active: a job of a suspended job definition is "executable" for the engine
    expect(jobs?.input.query).toEqual({
      executable: 'true',
      active: 'true',
      createTimes: 'lt_2026-01-01T11:55:00.000+0000',
      maxResults: '1000',
      processDefinitionKey: undefined,
    });
    expect(BASE_URL).toContain('engine-rest');
  });
});

describe('status details', () => {
  it('previews every request of round 1 with its query', () => {
    expect(
      statusRequests(OPTIONS, NOW).map((request) => [request.operationId, request.input.query]),
    ).toEqual([
      ['getRestAPIVersion', {}],
      ['getProcessDefinitionStatistics', { failedJobs: 'true', rootIncidents: 'true' }],
      [
        'getIncidents',
        {
          sortBy: 'incidentTimestamp',
          sortOrder: 'desc',
          processDefinitionKeyIn: undefined,
          firstResult: '0',
          maxResults: '500',
        },
      ],
      ['getIncidentsCount', { processDefinitionKeyIn: undefined }],
      [
        'getExternalTasks',
        { processDefinitionKeyIn: undefined, firstResult: '0', maxResults: '500' },
      ],
      ['getExternalTasksCount', { processDefinitionKeyIn: undefined }],
      ['getJobsCount', { executable: 'true', active: 'true', processDefinitionKey: undefined }],
      [
        'getJobs',
        {
          executable: 'true',
          active: 'true',
          createTimes: 'lt_2026-01-01T11:55:00.000+0000',
          maxResults: '1000',
          processDefinitionKey: undefined,
        },
      ],
      ['getTasksCount', { processDefinitionKeyIn: undefined }],
      ['getBatchStatistics', { maxResults: '100' }],
    ]);
  });

  it('notes capped overdue candidates per key and more groups than shown only beyond the limits', async () => {
    const jobs = Array.from({ length: 600 }, () => ({ dueDate: '2026-01-01T10:00:00.000+0000' }));
    const incidents = Array.from({ length: 3 }, (_, index) => ({
      id: `i${index}`,
      rootCauseIncidentId: `i${index}`,
      incidentType: 'custom',
      activityId: `a${index}`,
      processDefinitionId: 'order:1:x',
      incidentTimestamp: '2026-01-01T10:00:00.000+0000',
    }));
    const { deps } = engine({ staleJobs: jobs, incidents });
    const result = await status(deps, { ...OPTIONS, keys: ['order', 'pay'], maxGroups: 3 });
    expect(result.kind === 'view' ? result.view.truncated : 'x').toBeUndefined();
    expect(result.kind === 'view' ? result.view.jobs.overdue : 0).toBe(1200);
  });

  it('counts jobs as overdue only beyond the threshold, batches with failures only, and names the engine', async () => {
    const { deps } = engine({
      staleJobs: [
        { dueDate: '2026-01-01T11:56:00.000+0000' },
        { dueDate: '2026-01-01T11:54:00.000+0000' },
      ],
      batches: [{ id: 'b0', failedJobs: 0 }, { id: 'b1', failedJobs: 2 }, { id: 'b2' }],
    });
    const result = await status(deps, {
      ...OPTIONS,
      engine: { ...OPTIONS.engine, engine: 'second' },
    });
    if (result.kind !== 'view') throw new Error('expected a view');
    expect(result.view.jobs).toEqual({
      executable: 2,
      overdue: 1,
      oldestReadySince: '2026-01-01T11:54:00.000+0000',
    });
    expect(result.view.batches).toEqual({ running: 3, withFailures: 1 });
    expect(result.view.engine).toMatchObject({ engine: 'second' });
  });
});
