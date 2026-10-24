/** How every option of the workflow commands reaches the engine (requests) or the usage errors. */

import { describe, expect, it } from 'vitest';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import { type Stage, WorkflowEngine } from '../../../test/support/workflow-engine.js';
import { run } from '../run.js';

function setup(stage: Stage = 'approve', options: FakeRuntimeOptions = {}) {
  const engine = new WorkflowEngine(stage);
  const runtime = fakeRuntime({
    fetch: engine.fetch,
    onSleep: () => {
      engine.tick();
    },
    ...options,
  });
  const cli = async (args: readonly string[]) => {
    runtime.stdout.chunks.length = 0;
    runtime.stderr.chunks.length = 0;
    return execute(run, args, runtime);
  };
  return { engine, cli };
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

function bodyOf(engine: WorkflowEngine, path: string): unknown {
  const request = engine.requests.find((entry) => entry.path === path);
  return JSON.parse(typeof request?.body === 'string' ? request.body : 'null');
}

describe('inspect options', () => {
  it('sends the history requests only with --history and adds stacktraces only with --stacktrace', async () => {
    const plain = setup('failed');
    const view = JSON.parse((await plain.cli(['inspect', 'pi-1'])).stdout) as {
      incidents: { stacktrace?: string[] }[];
      timeline?: unknown;
    };
    expect(view.timeline).toBeUndefined();
    expect(view.incidents[0]?.stacktrace).toBeUndefined();
    expect(
      plain.engine.requests.some((request) =>
        request.path.startsWith('/history/activity-instance'),
      ),
    ).toBe(false);
    const full = setup('failed');
    const detailed = JSON.parse(
      (await full.cli(['inspect', 'pi-1', '--history', '--stacktrace'])).stdout,
    ) as { incidents: { stacktrace?: string[] }[]; timeline?: unknown[] };
    expect(detailed.timeline).toHaveLength(1);
    expect(detailed.incidents[0]?.stacktrace?.[0]).toMatch(
      /^org\.camunda\.bpm\.engine\.ProcessEngineException: /,
    );
  });

  it('selects the latest instance of a process definition key', async () => {
    const { cli, engine } = setup();
    expect(
      JSON.parse(
        (await cli(['inspect', '--process-definition-key', 'invoice', '--latest'])).stdout,
      ),
    ).toMatchObject({ id: 'pi-1' });
    expect(engine.requests[0]?.query.get('processDefinitionKey')).toBe('invoice');
  });
});

describe('wait options', () => {
  it.each([
    [['--business-key', 'B'], '--batch excludes --business-key'],
    [['--process-definition-key', 'k'], '--batch excludes --process-definition-key'],
    [['--latest'], '--batch excludes --latest'],
    [['--execute-jobs'], '--batch excludes --execute-jobs'],
    [['--no-variables'], '--batch excludes --no-variables'],
    [['--no-fail-on-incident'], '--batch excludes --no-fail-on-incident'],
    [['pi-1', '--until', 'idle'], '--batch excludes the process instance id, --until'],
  ])('refuses %j next to --batch', async (args, message) => {
    const { cli, engine } = setup();
    const result = await cli(['wait', '--batch', 'b1', ...args]);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message,
      hint: 'Wait for a batch (--batch <id>) or for a process instance, not both.',
    });
    expect(engine.requests).toEqual([]);
  });

  it('keeps waiting through an incident with --no-fail-on-incident until the timeout', async () => {
    const { cli } = setup('failed');
    const result = await cli([
      'wait',
      'pi-1',
      '--until',
      'ended',
      '--no-fail-on-incident',
      '--wait-timeout',
      '1s',
    ]);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'WAIT_TIMEOUT' });
    const fast = await cli(['wait', 'pi-1', '--until', 'ended', '--wait-timeout', '1s']);
    expect(errorOf(fast.stderr)).toMatchObject({ code: 'INCIDENT' });
  });

  it('works in read-only mode without --execute-jobs', async () => {
    const { cli } = setup();
    expect((await cli(['wait', 'pi-1', '--read-only'])).code).toBe(0);
  });
});

describe('advance options', () => {
  it('throws a BPMN error on the user task with a message and variables', async () => {
    const { cli, engine } = setup();
    engine.requests.length = 0;
    const result = await cli([
      'advance',
      'pi-1',
      '--bpmn-error',
      'REJECTED',
      '--error-message',
      'no money',
      '--var',
      'reason=x',
      '--dry-run',
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requests: [
        {
          summary: 'throw BPMN error REJECTED on user task task-1',
          body: {
            errorCode: 'REJECTED',
            errorMessage: 'no money',
            variables: { reason: { value: 'x', type: 'String' } },
          },
        },
      ],
    });
  });

  it.each([
    [['--local-var', 'a=1'], '--local-var applies to external tasks only; approve is a userTask'],
    [['--worker-id', 'w'], '--worker-id applies to external tasks only; approve is a userTask'],
    [
      ['--fail', 'x', '--retries', '0'],
      '--fail applies to external tasks only; approve is a userTask',
    ],
  ])('refuses %j on a user task', async (args, message) => {
    const { cli } = setup();
    expect(errorOf((await cli(['advance', 'pi-1', ...args])).stderr)).toMatchObject({
      code: 'USAGE',
      message,
    });
  });

  it('checks --retries as a number of at least 0', async () => {
    const { cli } = setup();
    expect(
      errorOf((await cli(['advance', 'pi-1', '--fail', 'x', '--retries', '-1'])).stderr),
    ).toMatchObject({ message: '--retries expects an integer between 0 and 2147483647, got "-1"' });
    expect(
      errorOf((await cli(['advance', 'pi-1', '--fail', 'x', '--retries', 'x'])).stderr),
    ).toMatchObject({ message: '--retries expects an integer, got "x"' });
    expect(errorOf((await cli(['advance', 'pi-1', '--no-fail-on-incident'])).stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: '--no-fail-on-incident needs --wait or --until',
      hint: 'Example: --wait --wait-timeout 2m',
    });
  });

  it('waits with --until alone', async () => {
    const { cli } = setup();
    const result = await cli(['advance', 'pi-1', '--until', 'incident']);
    expect(JSON.parse(result.stdout)).toMatchObject({
      instance: { waited: { until: 'incident' } },
    });
  });
});

describe('retry options', () => {
  it('filters by activity and incident type and sets the given retries', async () => {
    const { cli, engine } = setup('failed');
    const none = JSON.parse((await cli(['retry', 'pi-1', '--activity-id', 'other'])).stdout) as {
      incidents: unknown[];
    };
    expect(none.incidents).toEqual([]);
    const typed = JSON.parse(
      (await cli(['retry', 'pi-1', '--incident-type', 'failedExternalTask'])).stdout,
    ) as { incidents: unknown[] };
    expect(typed.incidents).toEqual([]);
    await cli([
      'retry',
      'pi-1',
      '--activity-id',
      'book',
      '--incident-type',
      'failedJob',
      '--retries',
      '3',
    ]);
    expect(bodyOf(engine, '/job/job-1/retries')).toEqual({ retries: 3 });
    expect(errorOf((await cli(['retry', 'pi-1', '--retries', '0'])).stderr)).toMatchObject({
      message: '--retries expects an integer between 1 and 2147483647, got "0"',
    });
  });

  it('works on a definition with --yes', async () => {
    const { cli } = setup('failed');
    expect(
      JSON.parse((await cli(['retry', '--process-definition-key', 'invoice', '--yes'])).stdout),
    ).toMatchObject({ retried: 1 });
  });
});

describe('deploy options', () => {
  const files = { 'bpmn/order.bpmn': '<x/>', 'base/sub/order.bpmn': '<x/>' };

  it.each([
    [['--business-key', 'B'], '--business-key'],
    [['--var', 'a=1'], '--var'],
    [['--wait'], '--wait'],
    [['--until', 'idle'], '--until'],
    [['--wait-timeout', '1s'], '--wait-timeout'],
    [['--no-fail-on-incident'], '--no-fail-on-incident'],
    [['--no-variables'], '--no-variables'],
  ])('refuses %j without --start', async (args, flag) => {
    const { cli, engine } = setup('none', { files });
    expect(errorOf((await cli(['deploy', 'bpmn', ...args])).stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: `${flag} needs --start or --start-key`,
      hint: 'Example: operate deploy order.bpmn --start --business-key B-1 --var amount=250',
    });
    expect(engine.requests).toEqual([]);
  });

  it('sends the name, the base directory names and the tenant', async () => {
    const { cli, engine } = setup('none', { files });
    const result = await cli([
      'deploy',
      'base/sub',
      '--name',
      'release',
      '--base-dir',
      'base',
      '--tenant-id',
      't1',
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      resources: [{ resource: 'sub/order.bpmn' }],
    });
    const form = engine.requests.find((request) => request.path === '/deployment/create')
      ?.body as FormData;
    expect([form.get('deployment-name'), form.get('tenant-id')]).toEqual(['release', 't1']);
    expect(engine.requests[0]?.query.get('name')).toBe('release');
  });

  it('starts by --start-key, waits with --wait and leaves out variables with --no-variables', async () => {
    const { cli } = setup('none', { files });
    const result = await cli([
      'deploy',
      'bpmn',
      '--start-key',
      'order',
      '--wait',
      '--no-variables',
    ]);
    const view = JSON.parse(result.stdout) as {
      instance: { waited?: unknown; variables?: unknown };
    };
    expect(view.instance.waited).toEqual({ until: 'idle', elapsedMs: 0, polls: 1 });
    expect(view.instance.variables).toBeUndefined();
  });
});

describe('status options', () => {
  it('passes --stale-after, --max-groups and the engine name', async () => {
    const { cli, engine } = setup('failed');
    const result = await cli([
      'status',
      '--stale-after',
      '1h',
      '--max-groups',
      '1',
      '--engine',
      'second',
      '--read-only',
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ engine: { engine: 'second' } });
    const jobs = engine.requests.find(
      (request) => request.path === '/job' && request.query.has('createTimes'),
    );
    expect(jobs?.query.get('createTimes')).toBe('lt_2023-11-14T21:13:20.000+0000');
    expect(errorOf((await cli(['status', '--max-groups', '101'])).stderr)).toMatchObject({
      message: '--max-groups expects an integer between 1 and 100, got "101"',
    });
    expect(errorOf((await cli(['status', '--stale-after', 'soon'])).stderr)).toMatchObject({
      message: '--stale-after expects a duration like 500ms, 30s, 2m or 1h, got "soon"',
    });
    const fresh = setup('failed');
    await fresh.cli(['status']);
    const defaults = fresh.engine.requests.find(
      (request) => request.path === '/job' && request.query.has('createTimes'),
    );
    expect(defaults?.query.get('createTimes')).toBe('lt_2023-11-14T22:08:20.000+0000');
  });
});
