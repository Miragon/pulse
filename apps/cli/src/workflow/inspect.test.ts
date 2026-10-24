import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { engineError, fakeServer, json, text } from '../../test/support/fake-fetch.js';
import {
  activity,
  activityTree,
  C,
  CHILD_DEF,
  DEFINITIONS,
  historyDto,
  JOB_DEFINITIONS,
  P,
  PARENT_DEF,
  runtimeDto,
} from '../../test/support/workflow-fixture.js';
import { OperateError } from '../errors.js';
import { incidentCause, inspect, instanceRequests, loadInstance, loadView } from './inspect.js';

const STACKTRACE =
  'org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: missingBean\n';

/** Parent waiting at its call activity, the child at `approve` with a failed job incident. */
function approveEngine() {
  const child = {
    id: C,
    definitionId: CHILD_DEF,
    definitionKey: 'workflow-child',
    suspended: false,
  };
  return fakeServer()
    .on('GET', `/process-instance/${P}`, json(runtimeDto))
    .on('GET', `/history/process-instance/${P}`, json(historyDto))
    .on('GET', '/process-instance', (request) =>
      json(request.query.get('superProcessInstance') === P ? [child] : []),
    )
    .on(
      'GET',
      `/process-instance/${P}/activity-instances`,
      json(
        activityTree(P, PARENT_DEF, [
          activity('call:ai', 'call-approval', 'callActivity', ['ex-call']),
        ]),
      ),
    )
    .on(
      'GET',
      `/process-instance/${C}/activity-instances`,
      json(
        activityTree(C, CHILD_DEF, [
          activity('approve:ai', 'approve', 'userTask', [C, 'name=Approve']),
        ]),
      ),
    )
    .on('GET', '/incident', (request) =>
      json(
        request.query.get('processInstanceId') === C
          ? [
              {
                id: 'i1',
                rootCauseIncidentId: 'i1',
                incidentType: 'failedJob',
                configuration: 'j1',
                activityId: 'approve',
                processInstanceId: C,
                incidentMessage: 'outer',
                incidentTimestamp: '2026-01-01T00:00:00.000+0000',
              },
            ]
          : [],
      ),
    )
    .on('GET', '/event-subscription', json([]))
    .on(
      'GET',
      '/task',
      json([{ id: 't1', taskDefinitionKey: 'approve', executionId: C, processInstanceId: C }]),
    )
    .on('GET', '/external-task', json([]))
    .on('GET', '/job', json([]))
    .on('GET', '/process-definition', json(DEFINITIONS))
    .on('GET', '/job-definition', (request) =>
      json(
        JOB_DEFINITIONS.filter(
          (definition) =>
            definition.processDefinitionId === request.query.get('processDefinitionId'),
        ),
      ),
    )
    .on(
      'GET',
      `/process-instance/${P}/variables`,
      json({ amount: { type: 'Integer', value: 250 } }),
    )
    .on('GET', '/job/j1/stacktrace', text(STACKTRACE, 'text/plain'))
    .on(
      'GET',
      '/history/activity-instance',
      json([
        {
          activityId: 'start',
          activityType: 'startEvent',
          startTime: '2026-01-01T00:00:00.000+0000',
        },
      ]),
    )
    .on('GET', '/history/incident', json([]));
}

const ALL = { variables: true, history: false, stacktrace: false };

describe('loadInstance', () => {
  it('loads the fixture with 19 requests in the documented rounds', async () => {
    const server = approveEngine();
    const view = await loadInstance(portOf(server.fetch), P, ALL);
    expect(server.requests).toHaveLength(19);
    const paths = server.requests.map((request) => request.path);
    expect(paths.slice(0, 2).sort()).toEqual([
      `/history/process-instance/${P}`,
      `/process-instance/${P}`,
    ]);
    expect(paths.at(-1)).toBe('/job/j1/stacktrace');
    expect(view).toMatchObject({
      waitingAt: [{ processInstanceId: C, activityId: 'approve', kind: 'userTask', taskId: 't1' }],
      incidents: [
        {
          id: 'i1',
          processInstanceId: C,
          rootCause: 'PropertyNotFoundException: missingBean',
          jobId: 'j1',
        },
      ],
      children: [{ id: C, key: 'workflow-child' }],
      variables: { amount: 250 },
    });
    const taskRequest = server.requests.find((request) => request.path === '/task');
    expect(taskRequest?.query.get('processInstanceIdIn')).toBe(`${P},${C}`);
  });

  it('leaves out the variables, adds the timeline and the stacktrace when asked', async () => {
    const server = approveEngine();
    const view = await loadInstance(portOf(server.fetch), P, {
      variables: false,
      history: true,
      stacktrace: true,
    });
    expect(view.variables).toBeUndefined();
    expect(view.timeline).toEqual([
      {
        activityId: 'start',
        activityType: 'startEvent',
        startTime: '2026-01-01T00:00:00.000+0000',
      },
    ]);
    expect(view.incidents[0]?.stacktrace).toEqual([
      'org.x.ProcessEngineException: outer',
      'Caused by: org.x.PropertyNotFoundException: missingBean',
    ]);
    expect(server.requests.some((request) => request.path.endsWith('/variables'))).toBe(false);
    const activities = server.requests.find(
      (request) => request.path === '/history/activity-instance',
    );
    expect(activities?.query.get('sortBy')).toBe('occurrence');
  });

  it('finds the parent without a history record', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/c1', json({ id: 'c1', definitionId: CHILD_DEF }))
      .on(
        'GET',
        '/history/process-instance/c1',
        engineError(404, 'InvalidRequestException', 'no history'),
      )
      .on('GET', '/process-instance', (request) =>
        json(request.query.get('subProcessInstance') === 'c1' ? [{ id: 'parent-1' }] : []),
      )
      .on('GET', '/process-instance/c1/activity-instances', json(activityTree('c1', CHILD_DEF, [])))
      .on('GET', '/incident', json([]))
      .on('GET', '/event-subscription', json([]))
      .on('GET', '/task', json([]))
      .on('GET', '/external-task', json([]))
      .on('GET', '/job', json([]))
      .on('GET', '/process-definition', json(DEFINITIONS))
      .on('GET', '/job-definition', json([]));
    const view = await loadInstance(portOf(server.fetch), 'c1', { ...ALL, variables: false });
    expect(view).toMatchObject({
      parentId: 'parent-1',
      state: 'ACTIVE',
      definition: { key: 'workflow-child', version: 1 },
    });
  });

  it('loads an ended instance from the history with its process scope variables', async () => {
    const server = fakeServer()
      .on('GET', `/process-instance/${P}`, engineError(404, 'InvalidRequestException', 'gone'))
      .on(
        'GET',
        `/history/process-instance/${P}`,
        json({ ...historyDto, state: 'COMPLETED', endTime: '2026-01-01T00:00:09.000+0000' }),
      )
      .on(
        'GET',
        '/history/variable-instance',
        json([
          { name: 'amount', type: 'Integer', value: 250, activityInstanceId: P },
          { name: 'local', type: 'String', value: 'x', activityInstanceId: 'task:1' },
        ]),
      );
    const view = await loadInstance(portOf(server.fetch), P, ALL);
    expect(view).toMatchObject({
      state: 'COMPLETED',
      waitingAt: [],
      variables: { amount: 250 },
      next: [`operate inspect ${P} --history`],
    });
    expect(
      server.requests
        .find((request) => request.path === '/history/variable-instance')
        ?.query.get('deserializeValues'),
    ).toBe('false');
  });

  it('is NOT_FOUND when neither runtime nor history know the id', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/x', engineError(404, 'InvalidRequestException', 'gone'))
      .on(
        'GET',
        '/history/process-instance/x',
        engineError(404, 'InvalidRequestException', 'gone'),
      );
    await expect(loadInstance(portOf(server.fetch), 'x', ALL)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Process instance x does not exist (neither running nor in the history)',
    });
    expect(await loadView(portOf(server.fetch), 'x', ALL)).toEqual({ id: 'x', state: 'ENDED' });
    const broken = fakeServer();
    await expect(loadView(portOf(broken.fetch), 'x', ALL)).rejects.toBeInstanceOf(OperateError);
  });
});

describe('an instance that ends while inspect reads it', () => {
  /** The job executor ends the instance after the first runtime read. */
  function racingEngine(after: 'activities' | 'variables') {
    let reads = 0;
    const gone = engineError(
      404,
      'InvalidRequestException',
      `Process instance ${P} does not exist`,
    );
    return approveEngine()
      .on('GET', `/process-instance/${P}`, () => (++reads === 1 ? json(runtimeDto) : gone.clone()))
      .on('GET', `/history/process-instance/${P}`, () =>
        json(reads === 1 ? historyDto : { ...historyDto, state: 'COMPLETED' }),
      )
      .on('GET', `/process-instance/${P}/activity-instances`, () =>
        after === 'activities'
          ? gone.clone()
          : json(
              activityTree(P, PARENT_DEF, [
                activity('call:ai', 'call-approval', 'callActivity', ['ex-call']),
              ]),
            ),
      )
      .on('GET', `/process-instance/${P}/variables`, () =>
        after === 'variables'
          ? engineError(
              500,
              'NullValueException',
              `execution ${P} doesn't exist: execution is null`,
            )
          : json({}),
      )
      .on('GET', '/history/variable-instance', json([]));
  }

  it('loads it again, then as ended, when its activity instances answer 404', async () => {
    const server = racingEngine('activities');
    const view = await loadInstance(portOf(server.fetch), P, ALL);
    expect(view).toMatchObject({ id: P, state: 'COMPLETED', waitingAt: [] });
    expect(
      server.requests.filter((request) => request.path === `/process-instance/${P}`),
    ).toHaveLength(2);
  });

  it('loads it again when its variables answer 500 NullValueException', async () => {
    const view = await loadInstance(portOf(racingEngine('variables').fetch), P, ALL);
    expect(view).toMatchObject({ state: 'COMPLETED', waitingAt: [] });
  });

  it('leaves out a called instance that ended since the tree was read', async () => {
    const server = approveEngine().on(
      'GET',
      `/process-instance/${C}/activity-instances`,
      engineError(404, 'InvalidRequestException', `Process instance ${C} does not exist`),
    );
    const view = await loadInstance(portOf(server.fetch), P, ALL);
    expect(view.children).toEqual([]);
    expect(view.incidents).toEqual([]);
    expect(view.state).toBe('ACTIVE');
  });

  it('gives up after the second attempt and rethrows other errors', async () => {
    const always = approveEngine().on(
      'GET',
      `/process-instance/${P}/activity-instances`,
      engineError(404, 'InvalidRequestException', 'gone'),
    );
    await expect(loadInstance(portOf(always.fetch), P, ALL)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: `Process instance ${P} does not exist (neither running nor in the history)`,
    });
    expect(await loadView(portOf(always.fetch), P, ALL)).toEqual({ id: P, state: 'ENDED' });
    const broken = approveEngine().on(
      'GET',
      `/process-instance/${P}/variables`,
      engineError(500, 'ProcessEngineException', 'database down'),
    );
    await expect(loadInstance(portOf(broken.fetch), P, ALL)).rejects.toMatchObject({
      code: 'HTTP_SERVER_ERROR',
    });
  });
});

describe('incidentCause', () => {
  it('reads the error details of a failed external task and falls back to the message', async () => {
    const server = fakeServer().on(
      'GET',
      '/external-task/e1/errorDetails',
      text('java.io.IOException: refused\n\tat x', 'text/plain'),
    );
    const port = portOf(server.fetch);
    expect(
      await incidentCause(
        port,
        { incidentType: 'failedExternalTask', configuration: 'e1', incidentMessage: 'm' },
        false,
      ),
    ).toEqual({ rootCause: 'IOException: refused' });
    expect(
      await incidentCause(port, { incidentType: 'custom', incidentMessage: 'm' }, true),
    ).toEqual({ rootCause: 'm' });
    expect(
      await incidentCause(port, { incidentType: 'failedJob', incidentMessage: 'm' }, true),
    ).toEqual({ rootCause: 'm' });
  });
});

describe('inspect', () => {
  it('previews the first round with --dry-run and sends nothing', async () => {
    const server = fakeServer();
    const port = portOf(server.fetch);
    expect(await inspect(port, { id: 'p1', latest: false }, { ...ALL, dryRun: true })).toEqual({
      kind: 'dry-run',
      requests: instanceRequests('p1'),
    });
    const filtered = await inspect(
      port,
      { businessKey: 'B', latest: false },
      { ...ALL, dryRun: true },
    );
    expect(
      filtered.kind === 'dry-run' ? filtered.requests.map((request) => request.operationId) : [],
    ).toEqual(['getHistoricProcessInstances', 'getProcessInstances']);
    expect(server.requests).toEqual([]);
    await expect(inspect(port, { latest: false }, { ...ALL, dryRun: true })).rejects.toThrow(
      'Select a process instance',
    );
  });

  it('selects and loads the instance', async () => {
    const result = await inspect(
      portOf(approveEngine().fetch),
      { id: P, latest: false },
      { ...ALL, dryRun: false },
    );
    expect(result.kind === 'view' ? result.view.id : undefined).toBe(P);
  });
});

describe('inspect requests', () => {
  const sent = (server: {
    requests: readonly { method: string; path: string; query: URLSearchParams }[];
  }) =>
    server.requests
      .map((request) => `${request.method} ${request.path}?${request.query.toString()}`)
      .sort();
  const page = 'firstResult=0&maxResults=500';
  const ids = `${P}%2C${C}`;
  const def = (id: string) => encodeURIComponent(id);

  it('sends every query of the documented rounds', async () => {
    const server = approveEngine();
    await loadInstance(portOf(server.fetch), P, { ...ALL, history: true });
    expect(sent(server)).toEqual([
      `GET /event-subscription?processInstanceId=${P}&${page}`,
      `GET /event-subscription?processInstanceId=${C}&${page}`,
      `GET /external-task?processInstanceIdIn=${ids}&${page}`,
      `GET /history/activity-instance?sortBy=occurrence&sortOrder=asc&${page}&processInstanceId=${P}`,
      `GET /history/incident?processInstanceId=${P}&${page}`,
      `GET /history/process-instance/${P}?`,
      `GET /incident?processInstanceId=${P}&${page}`,
      `GET /incident?processInstanceId=${C}&${page}`,
      `GET /job-definition?processDefinitionId=${def(CHILD_DEF)}&${page}`,
      `GET /job-definition?processDefinitionId=${def(PARENT_DEF)}&${page}`,
      'GET /job/j1/stacktrace?',
      `GET /job?processInstanceIds=${ids}&${page}`,
      `GET /job?processInstanceIds=${ids}&timers=true&${page}`,
      `GET /process-definition?processDefinitionIdIn=${def(PARENT_DEF)}%2C${def(CHILD_DEF)}&${page}`,
      `GET /process-instance/${P}/activity-instances?`,
      `GET /process-instance/${P}/variables?deserializeValues=false`,
      `GET /process-instance/${P}?`,
      `GET /process-instance/${C}/activity-instances?`,
      `GET /process-instance?firstResult=0&maxResults=101&superProcessInstance=${P}`,
      `GET /process-instance?firstResult=0&maxResults=101&superProcessInstance=${C}`,
      `GET /task?processInstanceIdIn=${ids}&${page}`,
    ]);
  });

  it('marks timer jobs from the timers query and keeps the job definitions of every definition', async () => {
    const server = approveEngine().on('GET', '/job', (request) =>
      json(
        request.query.get('timers') === 'true'
          ? [{ id: 'timer-1' }, {}]
          : [
              {
                id: 'timer-1',
                jobDefinitionId: 'jd-timer',
                processInstanceId: P,
                executionId: 'ex-call',
              },
            ],
      ),
    );
    const view = await loadInstance(portOf(server.fetch), P, ALL);
    expect(view.waitingAt).toContainEqual(
      expect.objectContaining({ kind: 'timer', jobId: 'timer-1', activityId: 'cool-down' }),
    );
  });

  it('loads the ended instance and its timeline with the instance queries', async () => {
    const server = fakeServer()
      .on('GET', `/process-instance/${P}`, engineError(404, 'InvalidRequestException', 'gone'))
      .on('GET', `/history/process-instance/${P}`, json({ ...historyDto, state: 'COMPLETED' }))
      .on('GET', '/history/variable-instance', json([]))
      .on('GET', '/history/activity-instance', json([{ id: 'h1', activityId: 'start' }]))
      .on(
        'GET',
        '/history/incident',
        json([{ id: 'hi', activityId: 'start', createTime: 't', incidentType: 'failedJob' }]),
      );
    const view = await loadInstance(portOf(server.fetch), P, { ...ALL, history: true });
    expect(view.timeline).toEqual([
      expect.objectContaining({
        activityId: 'start',
        incidents: [{ type: 'failedJob', state: 'resolved' }],
      }),
    ]);
    expect(sent(server)).toEqual([
      `GET /history/activity-instance?sortBy=occurrence&sortOrder=asc&${page}&processInstanceId=${P}`,
      `GET /history/incident?processInstanceId=${P}&${page}`,
      `GET /history/process-instance/${P}?`,
      `GET /history/variable-instance?processInstanceId=${P}&${page}&deserializeValues=false`,
      `GET /process-instance/${P}?`,
    ]);
  });

  it('keeps NOT_FOUND errors with a status and other errors in loadView', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/x', engineError(404, 'NotFoundException', 'gone'))
      .on('GET', '/history/process-instance/x', engineError(404, 'NotFoundException', 'gone'));
    await expect(loadView(portOf(server.fetch), 'x', ALL)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { status: 404 },
    });
    const failing = fakeServer()
      .on('GET', '/process-instance/x', engineError(500, 'ProcessEngineException', 'down'))
      .on('GET', '/history/process-instance/x', engineError(500, 'ProcessEngineException', 'down'));
    await expect(loadView(portOf(failing.fetch), 'x', ALL)).rejects.toThrow(/HTTP 500/);
  });

  it('keeps the hint of a missing instance and previews an empty id', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/x', engineError(404, 'InvalidRequestException', 'gone'))
      .on(
        'GET',
        '/history/process-instance/x',
        engineError(404, 'InvalidRequestException', 'gone'),
      );
    await expect(loadInstance(portOf(server.fetch), 'x', ALL)).rejects.toMatchObject({
      details: {
        hint: 'List instances with `operate process-instance list` (running) or `operate historic-process-instance list` (also ended); with history level none, ended instances cannot be found.',
      },
    });
  });
});
