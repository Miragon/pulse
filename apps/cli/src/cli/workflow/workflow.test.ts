import { describe, expect, it } from 'vitest';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import {
  ENGINE_URL,
  routes,
  type Stage,
  WorkflowEngine,
} from '../../../test/support/workflow-engine.js';
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
  return { engine, runtime, cli };
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

describe('operate inspect', () => {
  it('prints the instance view of a business key as JSON', async () => {
    const { cli, engine } = setup();
    const result = await cli(['inspect', '--business-key', 'B-1']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    const view = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(view)).toEqual(
      [
        'id',
        'businessKey',
        'definition',
        'state',
        'startTime',
        'rootId',
        'waitingAt',
        'incidents',
        'children',
        'variables',
        'next',
      ].filter((key) => key !== 'rootId'),
    );
    expect(view).toMatchObject({
      id: 'pi-1',
      state: 'ACTIVE',
      waitingAt: [
        { activityId: 'approve', kind: 'userTask', taskId: 'task-1', activityType: 'userTask' },
      ],
      next: ['operate advance pi-1'],
    });
    expect(routes(engine).slice(0, 2)).toEqual([
      'GET /history/process-instance',
      'GET /process-instance',
    ]);
  });

  it('prints sections on -o table, projections with --fields and warns about unknown fields', async () => {
    const { cli } = setup();
    const table = await cli(['inspect', 'pi-1', '-o', 'table']);
    expect(table.stdout).toContain('Process instance  pi-1\n');
    expect(table.stdout).toContain(
      '\nWaiting at:\nACTIVITY  KIND      ID      DETAIL   INSTANCE\napprove   userTask  task-1  Approve\n',
    );
    expect(table.stdout).toContain('\nNext:\n  operate advance pi-1\n');
    const fields = await cli(['inspect', 'pi-1', '--fields', 'id,state,nope']);
    expect(fields.stdout).toBe('{"id":"pi-1","state":"ACTIVE"}\n');
    expect(fields.stderr).toMatch(
      /^Warning: field "nope" not found in the response \(fields: id, /,
    );
    const projected = await cli(['inspect', 'pi-1', '--fields', 'id,state', '-o', 'table']);
    expect(projected.stdout).toBe('FIELD  VALUE\nid     pi-1\nstate  ACTIVE\n');
  });

  it('writes the JSON view to --out-file', async () => {
    const { cli, runtime } = setup();
    const result = await cli(['inspect', 'pi-1', '--out-file', 'view.json']);
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.stdout) as { bytes: number; contentType: string };
    expect(summary).toMatchObject({ outFile: 'view.json', contentType: 'application/json' });
    const written = new TextDecoder().decode(runtime.files.get('view.json')?.data);
    expect(JSON.parse(written)).toMatchObject({ id: 'pi-1' });
    expect(summary.bytes).toBe(new TextEncoder().encode(written).length);
  });

  it('sends nothing with --dry-run and previews the first round', async () => {
    const { cli, engine } = setup();
    const result = await cli(['inspect', '--business-key', 'B-1', '--dry-run']);
    expect(result.code).toBe(0);
    expect(engine.requests).toEqual([]);
    const preview = JSON.parse(result.stdout) as {
      plan?: unknown;
      requests: { url: string; curl: string }[];
    };
    expect(preview.plan).toBeUndefined();
    expect(preview.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/engine-rest/history/process-instance',
      '/engine-rest/process-instance',
    ]);
    const table = await cli(['inspect', 'pi-1', '--dry-run', '-o', 'table']);
    expect(table.stdout).toBe(
      `curl '${ENGINE_URL}/process-instance/pi-1' -H 'Accept: application/json'\ncurl '${ENGINE_URL}/history/process-instance/pi-1' -H 'Accept: application/json'\n`,
    );
  });

  it('prefixes every request with --engine and works in read-only mode', async () => {
    const { cli, engine } = setup();
    const result = await cli(['inspect', 'pi-1', '--engine', 'second', '--read-only']);
    expect(result.code).toBe(0);
    expect(engine.requests.length).toBeGreaterThan(5);
    expect(
      engine.requests.every((request) => request.url.startsWith(`${ENGINE_URL}/engine/second/`)),
    ).toBe(true);
  });

  it('reports an unknown instance as NOT_FOUND and wrong selections as usage errors', async () => {
    const { cli } = setup('none');
    const missing = await cli(['inspect', 'nope']);
    expect(missing.code).toBe(5);
    expect(missing.stdout).toBe('');
    expect(errorOf(missing.stderr)).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Process instance nope does not exist (neither running nor in the history)',
    });
    const both = await cli(['inspect', 'pi-1', '--business-key', 'B-1']);
    expect(errorOf(both.stderr)).toMatchObject({
      code: 'USAGE',
      message:
        'The process instance id excludes --business-key, --process-definition-key and --latest',
    });
    const none = await cli(['inspect']);
    expect(errorOf(none.stderr)).toMatchObject({
      code: 'USAGE',
      message: 'Select a process instance',
    });
  });
});

describe('operate wait', () => {
  it('prints the instance view with "waited" once the instance is idle', async () => {
    const { cli } = setup();
    const result = await cli(['wait', '--business-key', 'B-1', '--no-variables']);
    expect(result.code).toBe(0);
    const view = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(view.waited).toEqual({ until: 'idle', elapsedMs: 0, polls: 1 });
    expect(view.variables).toBeUndefined();
    const table = await cli(['wait', 'pi-1', '-o', 'table']);
    expect(table.stdout).toContain('Waited            idle after 0ms (1 poll)\n');
  });

  it('times out with exit code 9, the view on stdout and the poll schedule of the design', async () => {
    const { cli, runtime } = setup();
    const result = await cli(['wait', 'pi-1', '--until', 'ended', '--wait-timeout', '5s']);
    expect(result.code).toBe(9);
    expect(JSON.parse(result.stdout)).toMatchObject({ id: 'pi-1', state: 'ACTIVE' });
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'WAIT_TIMEOUT',
      exitCode: 9,
      message: 'Timed out after 5s waiting until ended (process instance pi-1)',
      data: { until: ['ended'], elapsedMs: 5000, polls: 6 },
    });
    expect(runtime.sleeps).toEqual([250, 500, 1000, 2000, 1250]);
  });

  it('fails fast with INCIDENT when the job executor fails the job', async () => {
    const { cli } = setup('book');
    const result = await cli(['wait', 'pi-1']);
    expect(result.code).toBe(9);
    const view = JSON.parse(result.stdout) as { incidents: { rootCause: string }[] };
    expect(view.incidents[0]?.rootCause).toBe(
      "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    );
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'INCIDENT',
      message:
        "Process instance pi-1 has an incident: failedJob at book: PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    });
  });

  it('executes due jobs with --execute-jobs and reports a failed job', async () => {
    const { cli, engine } = setup('book');
    const result = await cli(['wait', 'pi-1', '--execute-jobs']);
    expect(result.code).toBe(9);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'JOB_FAILED' });
    expect(routes(engine)).toContain('POST /job/job-1/execute');
    const refused = await cli(['wait', 'pi-1', '--execute-jobs', '--read-only']);
    expect(errorOf(refused.stderr)).toMatchObject({
      code: 'READ_ONLY',
      message: '`operate wait` is a write operation and read-only mode is enabled',
    });
  });

  it('waits for a batch and refuses instance options next to --batch', async () => {
    const { cli } = setup();
    const result = await cli(['wait', '--batch', 'batch-1']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      batch: {
        id: 'batch-1',
        type: 'instance-deletion',
        totalJobs: 1,
        startTime: '2026-10-09T10:00:00.000+0000',
        endTime: '2026-10-09T10:00:05.000+0000',
      },
      waited: { until: 'finished', elapsedMs: 0, polls: 1 },
    });
    const table = await cli(['wait', '--batch', 'batch-1', '-o', 'table']);
    expect(table.stdout).toContain('Batch       batch-1 (instance-deletion)\n');
    const conflict = await cli(['wait', 'pi-1', '--batch', 'b', '--until', 'idle']);
    expect(errorOf(conflict.stderr)).toMatchObject({
      code: 'USAGE',
      message: '--batch excludes the process instance id, --until',
    });
  });

  it('checks durations and conditions before sending anything', async () => {
    const { cli, engine } = setup();
    expect(errorOf((await cli(['wait', 'pi-1', '--wait-timeout', '0'])).stderr)).toMatchObject({
      message: '--wait-timeout expects a duration like 500ms, 30s, 2m or 1h, got "0"',
    });
    expect(errorOf((await cli(['wait', 'pi-1', '--until', 'done'])).stderr).message).toMatch(
      /^--until expects one of idle, ended/,
    );
    expect(engine.requests).toEqual([]);
    const preview = await cli(['wait', 'pi-1', '--dry-run']);
    expect(
      (JSON.parse(preview.stdout) as { requests: { url: string }[] }).requests.map(
        (request) => request.url,
      ),
    ).toEqual([`${ENGINE_URL}/process-instance/pi-1`]);
    expect(engine.requests).toEqual([]);
  });
});

describe('operate advance', () => {
  it('completes the user task and prints where the instance waits now', async () => {
    const { cli, engine } = setup();
    const result = await cli(['advance', '--business-key', 'B-1', '--var', 'approved=true']);
    expect(result.code).toBe(0);
    const view = JSON.parse(result.stdout) as {
      advanced: unknown;
      instance: { waitingAt: { kind: string }[] };
    };
    expect(view.advanced).toEqual({
      processInstanceId: 'pi-1',
      activityId: 'approve',
      kind: 'userTask',
      id: 'task-1',
      via: ['POST /task/task-1/complete'],
    });
    expect(view.instance.waitingAt[0]?.kind).toBe('asyncContinuation');
    expect(engine.variables).toEqual({ approved: { value: true, type: 'Boolean' } });
  });

  it('prints the advanced line and the instance on -o table', async () => {
    const { cli } = setup();
    const result = await cli(['advance', 'pi-1', '-o', 'table']);
    expect(result.stdout).toMatch(
      /^Advanced {2}approve \(userTask\) via POST \/task\/task-1\/complete\n\nProcess instance {2}pi-1\n/,
    );
  });

  it('sends only reads with --dry-run and previews the writes with a summary', async () => {
    const { cli, engine } = setup();
    const result = await cli(['advance', 'pi-1', '--dry-run']);
    expect(result.code).toBe(0);
    expect(engine.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(engine.stage).toBe('approve');
    const preview = JSON.parse(result.stdout) as {
      plan: unknown;
      requests: { summary: string; method: string }[];
    };
    expect(preview.plan).toEqual({
      processInstanceId: 'pi-1',
      activityId: 'approve',
      kind: 'userTask',
      id: 'task-1',
    });
    expect(preview.requests).toMatchObject([
      { summary: 'complete user task task-1', method: 'POST' },
    ]);
    const table = await cli(['advance', 'pi-1', '--dry-run', '-o', 'table']);
    expect(table.stdout).toMatch(/^# complete user task task-1\ncurl -X POST '/);
  });

  it('refuses in read-only mode before any request', async () => {
    const { cli, engine } = setup();
    const result = await cli(['advance', 'pi-1', '--read-only']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'READ_ONLY' });
    expect(engine.requests).toEqual([]);
  });

  it('waits after the write and fails fast on the incident of the next step', async () => {
    const { cli } = setup();
    const result = await cli(['advance', 'pi-1', '--wait']);
    expect(result.code).toBe(9);
    expect(JSON.parse(result.stdout)).toMatchObject({
      advanced: { kind: 'userTask' },
      instance: { incidents: [{ type: 'failedJob' }] },
    });
    expect(errorOf(result.stderr)).toMatchObject({ code: 'INCIDENT' });
  });

  it('executes an asynchronous job and reports its failure with exit code 9', async () => {
    const { cli } = setup('book');
    const result = await cli(['advance', 'pi-1']);
    expect(result.code).toBe(9);
    expect(JSON.parse(result.stdout)).toMatchObject({
      advanced: { kind: 'asyncContinuation', via: ['POST /job/job-1/execute'] },
    });
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'JOB_FAILED',
      message: `Job job-1 at book failed: Unknown property used in expression: \${missingBean.run()}. Cause: Cannot resolve identifier 'missingBean'`,
    });
  });

  it('checks the options before and after reading the instance', async () => {
    const { cli, engine } = setup();
    expect(errorOf((await cli(['advance', 'pi-1', '--wait-timeout', '1s'])).stderr)).toMatchObject({
      message: '--wait-timeout needs --wait or --until',
    });
    expect(errorOf((await cli(['advance', 'pi-1', '--retries', '1'])).stderr)).toMatchObject({
      message: '--retries needs --fail',
    });
    expect(engine.requests).toEqual([]);
    const fail = await cli(['advance', 'pi-1', '--fail', 'x']);
    expect(errorOf(fail.stderr)).toMatchObject({
      code: 'USAGE',
      message: '--fail applies to external tasks only; approve is a userTask',
    });
    const other = await cli(['advance', 'pi-1', '--activity-id', 'nope']);
    expect(errorOf(other.stderr)).toMatchObject({
      message: 'Process instance pi-1 does not wait at nope',
      hint: 'It waits at: approve (userTask).',
    });
  });
});

describe('operate retry', () => {
  it('retries the failed job of an instance and executes it with --now', async () => {
    const { cli, engine } = setup('failed');
    const result = await cli(['retry', '--business-key', 'B-1', '--now']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      retried: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      gone: 0,
      incidents: [
        {
          incidentId: 'inc-1',
          type: 'failedJob',
          activityId: 'book',
          processInstanceId: 'pi-1',
          jobId: 'job-1',
          action: 'retries=1, execute',
          result: 'succeeded',
        },
      ],
    });
    expect(engine.stage).toBe('ended');
  });

  it('prints the report table, waits with --wait and refuses --wait without an instance', async () => {
    const { cli } = setup('failed');
    const result = await cli(['retry', 'pi-1', '--wait', '--until', 'ended', '-o', 'table']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^INCIDENT {2}TYPE {7}ACTIVITY {2}RESULT {3}ROOT CAUSE\ninc-1 {5}failedJob {2}book {6}retried\n\nRetried 1, succeeded 0, failed 0, skipped 0, gone 0\n\nProcess instance {2}pi-1\nState {13}COMPLETED\n/,
    );
    const usage = await cli(['retry', '--incident', 'inc-1', '--wait']);
    expect(errorOf(usage.stderr)).toMatchObject({
      message: '--wait and --until need a process instance',
    });
  });

  it('needs --yes for a whole definition, previews with --dry-run and reads named incidents', async () => {
    const { cli, engine } = setup('failed');
    const refused = await cli(['retry', '--process-definition-key', 'invoice']);
    expect(errorOf(refused.stderr)).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      message: '`operate retry` is a bulk operation and needs confirmation',
    });
    expect(engine.requests).toEqual([]);
    const preview = await cli([
      'retry',
      '--process-definition-key',
      'invoice',
      '--dry-run',
      '--now',
    ]);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      plan: { mode: 'definition', incidents: 1, jobs: 1, externalTasks: 0, skipped: [] },
      requests: [
        { summary: 'set the retries of job job-1 to 1', method: 'PUT' },
        { summary: 'execute job job-1', method: 'POST' },
      ],
    });
    const named = await cli(['retry', '--incident', 'inc-1', '--retries', '2']);
    expect(JSON.parse(named.stdout)).toMatchObject({
      retried: 1,
      incidents: [{ action: 'retries=2', result: 'retried' }],
    });
    const mixed = await cli(['retry', 'pi-1', '--incident', 'inc-1']);
    expect(errorOf(mixed.stderr).message).toMatch(/^--incident excludes/);
    expect(errorOf((await cli(['retry', 'pi-1', '--incident-type', 'nope'])).stderr)).toMatchObject(
      { message: '--incident-type expects one of failedJob, failedExternalTask, got "nope"' },
    );
  });

  it('reports nothing to retry with zeros', async () => {
    const { cli } = setup();
    const result = await cli(['retry', 'pi-1', '-o', 'table']);
    expect(result.stdout).toBe(
      'No open incidents to retry.\nRetried 0, succeeded 0, failed 0, skipped 0, gone 0\n',
    );
  });
});

describe('operate deploy', () => {
  const files = {
    'bpmn/order.bpmn':
      '<bpmn:definitions><bpmn:process id="order" isExecutable="true"/></bpmn:definitions>',
    'bpmn/forms/approve.form': '{}',
    'bpmn/.git/x.bpmn': '<x/>',
  };

  it('deploys a directory once and reports unchanged resources afterwards', async () => {
    const { cli, engine } = setup('none', { files });
    const first = await cli(['deploy', 'bpmn']);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      name: 'operate',
      changed: true,
      resources: [
        { resource: 'forms/approve.form', status: 'deployed', definitions: [] },
        {
          resource: 'order.bpmn',
          status: 'deployed',
          definitions: [{ type: 'process', key: 'order', version: 1 }],
        },
      ],
    });
    const form = engine.requests.find((request) => request.path === '/deployment/create')
      ?.body as FormData;
    expect(form.get('deployment-source')).toBe('operate');
    expect(form.get('deploy-changed-only')).toBe('true');
    const second = await cli(['deploy', 'bpmn', '-o', 'table']);
    expect(second.stdout).toContain('(operate, unchanged)');
    expect(second.stdout).toContain('order.bpmn          unchanged  process  order  1');
  });

  it('starts an instance of the only process with --start', async () => {
    const { cli, engine } = setup('none', { files });
    const result = await cli([
      'deploy',
      'bpmn/order.bpmn',
      '--start',
      '--business-key',
      'B-2',
      '--var',
      'amount=250',
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      instance: { id: 'pi-1', businessKey: 'B-2', waitingAt: [{ activityId: 'approve' }] },
    });
    expect(engine.variables).toEqual({ amount: { value: 250, type: 'Integer' } });
  });

  it('sends nothing with --dry-run and checks the start options', async () => {
    const { cli, engine } = setup('none', { files });
    const preview = await cli(['deploy', 'bpmn', '--dry-run', '--start-key', 'order']);
    expect(engine.requests).toEqual([]);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      plan: {
        name: 'operate',
        resources: [
          { resource: 'forms/approve.form', file: 'bpmn/forms/approve.form' },
          { resource: 'order.bpmn', file: 'bpmn/order.bpmn' },
        ],
        start: { key: 'order' },
      },
      requests: [{ summary: 'deploy 2 resource(s) as operate', method: 'POST' }],
    });
    expect(errorOf((await cli(['deploy', 'bpmn', '--business-key', 'B-1'])).stderr)).toMatchObject({
      message: '--business-key needs --start or --start-key',
    });
    expect(errorOf((await cli(['deploy', 'missing'])).stderr)).toMatchObject({
      message: 'File not found: missing',
    });
    expect(errorOf((await cli(['deploy', 'bpmn', '--read-only'])).stderr)).toMatchObject({
      code: 'READ_ONLY',
    });
  });
});

describe('operate status', () => {
  it('reports the incident group as a warning finding with the next command', async () => {
    const { cli } = setup('failed');
    const result = await cli(['status']);
    expect(result.code).toBe(0);
    const view = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(view).toMatchObject({
      engine: { url: ENGINE_URL, version: '7.24.0' },
      status: 'warning',
      findings: [
        {
          severity: 'warning',
          code: 'INCIDENTS',
          next: 'operate retry --process-definition-key invoice --activity-id book --dry-run',
        },
      ],
      incidents: [
        {
          processDefinitionKey: 'invoice',
          activityId: 'book',
          count: 1,
          rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
        },
      ],
      jobs: { executable: 0, overdue: 0 },
      tasks: { open: 0 },
      batches: { running: 0, withFailures: 0 },
    });
    const table = await cli(['status', '-o', 'table']);
    expect(table.stdout).toMatch(
      /^Engine {2}http:\/\/localhost:8080\/engine-rest \(version 7\.24\.0, 0ms\)\nStatus {2}warning\n\nFindings:\n {2}warning {2}1 failedJob incident at invoice\/book: /,
    );
  });

  it('fails with CHECK_FAILED after printing the view when --fail-on is reached', async () => {
    const { cli } = setup('failed');
    const result = await cli(['status', '--fail-on', 'warning', '--fields', 'status']);
    expect(result.code).toBe(9);
    expect(result.stdout).toBe('{"status":"warning"}\n');
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'CHECK_FAILED',
      message: 'Engine status is warning (1 finding)',
    });
    expect((await cli(['status', '--fail-on', 'critical'])).code).toBe(0);
    expect(errorOf((await cli(['status', '--fail-on', 'never'])).stderr)).toMatchObject({
      code: 'USAGE',
    });
  });

  it('previews round 1 with --dry-run', async () => {
    const { cli, engine } = setup();
    const result = await cli([
      'status',
      '--dry-run',
      '--process-definition-key',
      'a',
      '--process-definition-key',
      'b',
    ]);
    expect(engine.requests).toEqual([]);
    const urls = (JSON.parse(result.stdout) as { requests: { url: string }[] }).requests.map(
      (request) => new URL(request.url),
    );
    expect(urls.map((url) => url.pathname.replace('/engine-rest', ''))).toEqual([
      '/version',
      '/process-definition/statistics',
      '/incident',
      '/incident/count',
      '/external-task',
      '/external-task/count',
      '/job/count',
      '/job/count',
      '/job',
      '/job',
      '/task/count',
    ]);
    expect(urls[2]?.searchParams.get('processDefinitionKeyIn')).toBe('a,b');
    expect(errorOf((await cli(['status', '--max-groups', '0'])).stderr)).toMatchObject({
      message: '--max-groups expects an integer between 1 and 100, got "0"',
    });
  });
});

describe('workflow commands in the CLI', () => {
  it('points "operate workflow <command>" to the top-level command', async () => {
    const { cli } = setup();
    const result = await cli(['workflow', 'inspect', 'pi-1']);
    expect(errorOf(result.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unknown command "workflow"',
      hint: 'Workflow commands are top-level: operate inspect. "operate commands workflow" lists them.',
    });
  });

  it('accepts global options before the command', async () => {
    const { cli } = setup();
    const result = await cli(['-o', 'table', 'inspect', 'pi-1']);
    expect(result.stdout).toMatch(/^Process instance {2}pi-1\n/);
  });
});

describe('workflow commands in help, commands and describe', () => {
  it('documents every workflow command with requests, effect, options, global options and examples', async () => {
    const { cli } = setup();
    for (const name of ['inspect', 'wait', 'advance', 'retry', 'deploy', 'status']) {
      const { stdout, code } = await cli([name, '--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(new RegExp(`^Usage: operate ${name} `));
      const headings = stdout
        .split('\n')
        .filter((line) =>
          /^(?:Requests|Effect|Options|Global Options|Examples|Arguments):/.test(line),
        );
      expect(
        headings
          .map((line) => line.split(':')[0])
          .filter((heading, index, all) => all.indexOf(heading) === index),
      ).toEqual(
        expect.arrayContaining(['Requests', 'Effect', 'Options', 'Global Options', 'Examples']),
      );
      expect(stdout).toContain(`\n  $ operate ${name}`);
    }
    const wait = await cli(['wait', '--help']);
    expect(wait.stdout).toContain('\nEffect: read; write with --execute-jobs\n');
    expect(wait.stdout).toMatch(/\n {2}--wait-timeout <duration> +Total wait budget like 500ms/);
  });

  it('lists the workflow commands with `commands workflow` and describes one', async () => {
    const { cli } = setup();
    const table = await cli(['commands', 'workflow', '-o', 'table']);
    expect(table.stdout.split('\n').slice(0, 3)).toEqual([
      'COMMAND  EFFECT  SUMMARY',
      'inspect  read    Show where a process instance waits and why: wait states, incidents with root cause, called instances,…',
      'wait     read    Wait until a process instance is idle, ended, has an incident or reached an activity, or a batch finis…',
    ]);
    const described = JSON.parse((await cli(['describe', 'inspect'])).stdout) as Record<
      string,
      unknown
    >;
    expect(described).toMatchObject({
      command: 'operate inspect [process-instance-id]',
      workflow: true,
      effect: 'read',
    });
    expect((await cli(['describe', 'retry', '-o', 'table'])).stdout).toMatch(
      /^USAGE\n {2}operate retry \[process-instance-id\] \[options\]\n/,
    );
    expect(JSON.parse((await cli(['describe', 'workflow'])).stdout)).toHaveLength(6);
    const unknown = await cli(['describe', 'inspekt']);
    expect(errorOf(unknown.stderr)).toMatchObject({
      code: 'USAGE',
      hint: expect.stringMatching(/^Did you mean inspect\? /),
    });
  });
});

describe('workflow comfort details', () => {
  it('keeps the other options in the ready commands of an ambiguous selection', async () => {
    const runtime = fakeRuntime({
      fetch: (input) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        const body = url.pathname.endsWith('/history/process-instance')
          ? [
              { id: 'a', state: 'ACTIVE' },
              { id: 'b', state: 'ACTIVE' },
            ]
          : [];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    const result = await execute(
      run,
      [
        'advance',
        '--business-key',
        'DUP',
        '--var',
        'approved=true',
        '--wait',
        '--wait-timeout',
        '2m',
      ],
      runtime,
    );
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr).hint).toBe(
      'Choose one: operate advance a --var approved=true --wait --wait-timeout 2m, operate advance b --var approved=true --wait --wait-timeout 2m; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.',
    );
  });

  it('says on a terminal that it waits, and nothing on a pipe', async () => {
    const terminal = setup('approve', { stderrTTY: true });
    const waited = await terminal.cli(['wait', 'pi-1', '--until', 'ended', '--wait-timeout', '1s']);
    expect(waited.code).toBe(9);
    expect(waited.stderr.startsWith('Waiting until ended (up to 1s; Ctrl-C to stop)...\n')).toBe(
      true,
    );
    const pipe = setup('approve');
    const quiet = await pipe.cli(['wait', 'pi-1', '--until', 'ended', '--wait-timeout', '1s']);
    expect(quiet.stderr).not.toContain('Waiting until');
  });
});
