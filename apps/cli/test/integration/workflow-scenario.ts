/**
 * The workflow commands (design §17) of the built CLI against one real engine: the fixture
 * `workflow.bpmn` (call activity with a user task in the child, external task, message, timer,
 * asynchronous job that fails, receive task) is deployed, started, inspected, advanced step by
 * step, waited for, retried and ended, like a developer or an agent would. The tests build on each
 * other.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argv } from './support/catalog.js';
import { assertCliBuilt, bindCli, type Cli } from './support/cli.js';
import {
  ENGINE_START_TIMEOUT_MS,
  type EngineName,
  isEngineEnabled,
  type RunningEngine,
  startEngine,
} from './support/engines.js';
import { expectError, expectExit, expectSuccess, required } from './support/expect.js';
import { FIXTURES } from './support/fixtures.js';
import { makeTempDir, removeTempDir } from './support/temp.js';
import type { DryRunOutput } from './support/types.js';

interface Definition {
  readonly type: string;
  readonly key: string;
  readonly version: number;
}

interface DeployOutput {
  readonly deploymentId: string;
  readonly changed: boolean;
  readonly resources: readonly {
    readonly resource: string;
    readonly status: string;
    readonly definitions: readonly Definition[];
  }[];
  readonly instance?: InstanceOutput;
}

interface WaitState {
  readonly activityId: string;
  readonly kind: string;
  readonly activityType?: string;
  readonly processInstanceId?: string;
  readonly taskId?: string;
  readonly suspended?: boolean;
}

interface InstanceOutput {
  readonly id: string;
  readonly state: string;
  readonly waitingAt: readonly WaitState[];
  readonly incidents: readonly {
    readonly type: string;
    readonly activityId: string;
    readonly rootCause?: string;
  }[];
  readonly children: readonly { readonly id: string; readonly key: string }[];
  readonly timeline?: readonly { readonly activityId: string }[];
  readonly next?: readonly string[];
}

interface StatusOutput {
  readonly findings: readonly { code: string; message: string; next?: string }[];
  readonly externalTasks: readonly { topic: string; waiting: number; lockExpired: number }[];
}

/** Another team's file with the same resource name (`workflow.bpmn`) and another process. */
const FOREIGN_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="other" targetNamespace="https://example.com/other">
  <bpmn:process id="other-process" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="s" /><bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e" /><bpmn:endEvent id="e" />
  </bpmn:process>
</bpmn:definitions>
`;

interface AdvanceOutput {
  readonly advanced: {
    readonly activityId: string;
    readonly kind: string;
    readonly via: readonly string[];
  };
  readonly instance?: InstanceOutput;
}

const BUSINESS_KEY = 'WF-1';
const BY_KEY = ['--business-key', BUSINESS_KEY];

export function registerWorkflowScenario(engineName: EngineName): void {
  describe.skipIf(!isEngineEnabled(engineName))(`workflow commands against ${engineName}`, () => {
    let engine: RunningEngine | undefined;
    let workdir: string | undefined;
    let cli: Cli = () => Promise.reject(new Error('the engine did not start'));
    const state: { deploymentId?: string; instanceId?: string } = {};

    const bpmnDir = () => join(required(workdir, 'workdir'), 'bpmn');

    beforeAll(async () => {
      assertCliBuilt();
      workdir = await makeTempDir(`operate-it-workflow-${engineName}-`);
      const configFile = join(workdir, 'config.json');
      await writeFile(configFile, '{"profiles":{}}\n');
      await mkdir(join(workdir, 'bpmn'));
      await copyFile(FIXTURES.workflow, join(workdir, 'bpmn', 'workflow.bpmn'));
      await mkdir(join(workdir, 'other'));
      await writeFile(join(workdir, 'other', 'workflow.bpmn'), FOREIGN_BPMN);
      engine = await startEngine(engineName);
      cli = bindCli({
        url: engine.url,
        configFile,
        env: { XDG_CONFIG_HOME: workdir, OPERATE_PLATFORM: engine.platform },
      });
    }, ENGINE_START_TIMEOUT_MS);

    afterAll(async () => {
      await engine?.stop();
      await removeTempDir(workdir);
    });

    async function inspect(...extra: string[]): Promise<InstanceOutput> {
      return expectSuccess(await cli(['inspect', ...BY_KEY, ...extra])).json<InstanceOutput>();
    }

    it('deploys the directory once; a second deploy changes nothing', async () => {
      const first = expectSuccess(await cli(['deploy', bpmnDir()])).json<DeployOutput>();
      expect(first).toMatchObject({
        changed: true,
        resources: [{ resource: 'workflow.bpmn', status: 'deployed' }],
      });
      const keys = first.resources[0]?.definitions.map((definition) => [
        definition.key,
        definition.version,
      ]);
      expect(keys).toEqual([
        ['workflow-child', 1],
        ['workflow-parent', 1],
      ]);
      state.deploymentId = first.deploymentId;

      const second = expectSuccess(await cli(['deploy', bpmnDir()])).json<DeployOutput>();
      expect(second).toMatchObject({
        deploymentId: first.deploymentId,
        changed: false,
        resources: [{ status: 'unchanged' }],
      });
      expect(second.resources[0]?.definitions).toEqual(first.resources[0]?.definitions);
    });

    it("ignores another deployment's resource of the same name; --start refuses before deploying", async () => {
      const dir = required(workdir, 'workdir');
      expectSuccess(await cli(['deploy', join(dir, 'other', 'workflow.bpmn'), '--name', 'team-b']));
      const unchanged = expectSuccess(await cli(['deploy', bpmnDir()])).json<DeployOutput>();
      expect(unchanged.resources[0]?.definitions.map((definition) => definition.key)).toEqual([
        'workflow-child',
        'workflow-parent',
      ]);
      const refused = expectError(await cli(['deploy', bpmnDir(), '--start']), 'USAGE', 2);
      expect(refused.message).toBe(
        'The files contain 2 processes: workflow-child, workflow-parent',
      );
      const after = expectSuccess(await cli(['deploy', bpmnDir()])).json<DeployOutput>();
      expect(after.deploymentId).toBe(state.deploymentId);
    });

    it('starts an instance that waits at the user task of the called instance', async () => {
      const result = await cli([
        'deploy',
        bpmnDir(),
        '--start-key',
        'workflow-parent',
        ...BY_KEY,
        '--var',
        'failBooking=true',
      ]);
      const instance = required(
        expectSuccess(result).json<DeployOutput>().instance,
        'the started instance',
      );
      expect(instance.waitingAt).toEqual([
        expect.objectContaining({ activityId: 'approve', kind: 'userTask' }),
      ]);
      expect(instance.children).toEqual([expect.objectContaining({ key: 'workflow-child' })]);
      expect(instance.waitingAt[0]?.processInstanceId).toBe(instance.children[0]?.id);
      state.instanceId = instance.id;
    });

    it('inspects the instance as a table, also in read-only mode', async () => {
      const table = expectSuccess(await cli(['inspect', ...BY_KEY, '-o', 'table', '--read-only']));
      expect(table.stdout).toContain('\nWaiting at:\n');
      expect(table.stdout).toMatch(/\napprove +userTask /);
    });

    it('previews advance with --dry-run without completing the task; refuses it read-only', async () => {
      const preview = expectSuccess(await cli(['advance', ...BY_KEY, '--dry-run'])).json<{
        requests: (DryRunOutput & { summary: string })[];
      }>();
      expect(preview.requests).toHaveLength(1);
      expect(preview.requests[0]).toMatchObject({
        method: 'POST',
        summary: expect.stringMatching(/^complete user task /),
      });
      expect(new URL(preview.requests[0]?.url ?? '').pathname).toMatch(/\/task\/[^/]+\/complete$/);
      expect((await inspect()).waitingAt[0]?.kind).toBe('userTask');
      expectError(await cli(['advance', ...BY_KEY, '--read-only']), 'READ_ONLY', 2);
    });

    it('completes the user task, then locks and completes the external task', async () => {
      const task = expectSuccess(
        await cli(['advance', ...BY_KEY, '--var', 'approved=true']),
      ).json<AdvanceOutput>();
      expect(task.advanced).toMatchObject({ activityId: 'approve', kind: 'userTask' });
      expect(task.instance?.waitingAt).toEqual([
        expect.objectContaining({ activityId: 'charge', kind: 'externalTask' }),
      ]);

      // a reported failure with retries left waits for its retry: no "worker crashed"
      expectSuccess(
        await cli([
          'advance',
          ...BY_KEY,
          '--activity-id',
          'charge',
          '--fail',
          'PSP timeout',
          '--retries',
          '2',
        ]),
      );
      const status = expectSuccess(
        await cli(['status', '--stale-after', '1ms']),
      ).json<StatusOutput>();
      expect(status.findings.map((finding) => finding.code)).not.toContain('LOCK_EXPIRED');
      expect(status.externalTasks).toContainEqual(
        expect.objectContaining({ topic: 'workflow-charge', waiting: 1, lockExpired: 0 }),
      );

      const external = expectSuccess(
        await cli(['advance', ...BY_KEY, '--activity-id', 'charge']),
      ).json<AdvanceOutput>();
      expect(external.advanced.via).toEqual([
        expect.stringMatching(/^POST \/external-task\/[^/]+\/lock$/),
        expect.stringMatching(/^POST \/external-task\/[^/]+\/complete$/),
      ]);
      expect(external.instance?.waitingAt).toEqual([
        expect.objectContaining({ activityId: 'paid', kind: 'message' }),
      ]);
    });

    it('times out with exit code 9 and prints the view at the message', async () => {
      const result = await cli(['wait', ...BY_KEY, '--until', 'task', '--wait-timeout', '1s']);
      expectError(result, 'WAIT_TIMEOUT', 9);
      expect(result.json<InstanceOutput>().waitingAt).toEqual([
        expect.objectContaining({ activityId: 'paid' }),
      ]);
    });

    it('refuses a typo in --until at once, before any write, and knows the called process', async () => {
      const typo = expectError(
        await cli(['wait', ...BY_KEY, '--until', 'activity:paidd']),
        'USAGE',
        2,
      );
      expect(typo.message).toBe(
        '--until activity:paidd: no such element in the BPMN of workflow-parent, workflow-child',
      );
      expect(typo.hint).toMatch(/^Did you mean activity:paid\? /);
      const write = await cli(['advance', ...BY_KEY, '--until', 'task:aprove']);
      expect(expectError(write, 'USAGE', 2).hint).toMatch(/^Did you mean task:approve\? /);
      expect((await inspect()).waitingAt).toEqual([
        expect.objectContaining({ activityId: 'paid' }),
      ]);
      expectSuccess(
        await cli(['wait', ...BY_KEY, '--until', 'activity:paid', '--wait-timeout', '5s']),
      );
    });

    it('triggers the message, then fires the timer and fails fast on the incident of the job', async () => {
      const message = expectSuccess(await cli(['advance', ...BY_KEY])).json<AdvanceOutput>();
      expect(message.advanced.kind).toBe('message');
      expect(message.instance?.waitingAt).toEqual([
        expect.objectContaining({ activityId: 'cool-down', kind: 'timer' }),
      ]);

      const timer = await cli(['advance', ...BY_KEY, '--wait']);
      expectError(timer, 'INCIDENT', 9);
      const view = timer.json<AdvanceOutput>();
      expect(view.advanced.kind).toBe('timer');
      expect(view.instance?.incidents[0]).toMatchObject({ type: 'failedJob', activityId: 'book' });
      expect(view.instance?.incidents[0]?.rootCause).toContain('missingBean');
    });

    it('shows the stacktrace in the table and projects fields of the wait states', async () => {
      const table = expectSuccess(await cli(['inspect', ...BY_KEY, '--stacktrace', '-o', 'table']));
      expect(table.stdout).toContain('\nStacktrace (failedJob at book, incident ');
      expect(table.stdout).toMatch(/\n +at org\./);
      const projected = expectSuccess(
        await cli(['inspect', ...BY_KEY, '--fields', 'waitingAt.activityId,waitingAt.kind']),
      );
      expect(projected.json()).toEqual({
        waitingAt: [{ activityId: 'book', kind: 'asyncContinuation' }],
      });
      expect(projected.stderr).toBe('');
    });

    it('reports the incident group in status and fails CI with --fail-on warning', async () => {
      const status = expectSuccess(await cli(['status'])).json<{
        findings: { code: string; message: string; next?: string }[];
      }>();
      const finding = status.findings.find(
        (entry) => entry.code === 'INCIDENTS' && entry.message.includes('workflow-parent/book'),
      );
      expect(finding?.message).toContain('missingBean');
      expect(finding?.next).toBe(
        'operate retry --process-definition-key workflow-parent --activity-id book --dry-run',
      );
      expectError(await cli(['status', '--fail-on', 'warning']), 'CHECK_FAILED', 9);
    });

    it('retries the job after fixing the cause, then waits at the receive task', async () => {
      const id = required(state.instanceId, 'instanceId');
      expectSuccess(
        await cli(argv('process-instance set-variable', [id, 'failBooking'], { value: 'false' })),
      );
      const retried = expectSuccess(await cli(['retry', ...BY_KEY, '--now'])).json<{
        incidents: { result: string }[];
      }>();
      expect(retried.incidents).toEqual([expect.objectContaining({ result: 'succeeded' })]);
      expect((await inspect()).waitingAt).toEqual([
        expect.objectContaining({
          activityId: 'wait-signal',
          kind: 'other',
          activityType: 'receiveTask',
        }),
      ]);
    });

    it('signals the receive task and shows the timeline of the completed instance', async () => {
      const done = expectSuccess(await cli(['advance', ...BY_KEY])).json<AdvanceOutput>();
      expect(done.instance?.state).toBe('COMPLETED');
      const history = await inspect('--history');
      expect(history.timeline?.map((entry) => entry.activityId)).toEqual([
        'start',
        'call-approval',
        'charge',
        'paid',
        'cool-down',
        'book',
        'wait-signal',
        'end',
      ]);
    });

    it('needs --yes to retry a whole definition and previews an empty plan', async () => {
      expectError(
        await cli(['retry', '--process-definition-key', 'workflow-parent']),
        'CONFIRMATION_REQUIRED',
        2,
      );
      const preview = expectSuccess(
        await cli(['retry', '--process-definition-key', 'workflow-parent', '--dry-run']),
      ).json<{ plan: unknown; requests: unknown[] }>();
      expect(preview).toEqual({
        plan: { mode: 'definition', incidents: 0, jobs: 0, externalTasks: 0, skipped: [] },
        requests: [],
      });
    });

    it('waits for a deletion batch', async () => {
      expectSuccess(
        await cli(argv('process-definition start', ['workflow-parent'], { businessKey: 'WF-2' })),
      );
      const batch = expectSuccess(
        await cli(
          argv('process-instance delete-async', [], {
            body: JSON.stringify({ processInstanceQuery: { businessKey: 'WF-2' } }),
            yes: true,
          }),
        ),
      ).json<{ id: string }>();
      const waited = expectSuccess(
        await cli(['wait', '--batch', batch.id, '--wait-timeout', '2m'], { timeoutMs: 180_000 }),
      );
      expect(waited.json<{ batch: { id: string; endTime?: string } }>().batch).toMatchObject({
        id: batch.id,
        endTime: expect.any(String),
      });
    }, 180_000);

    it('reports an unknown instance with exit code 5, also to retry', async () => {
      expectExit(await cli(['inspect', '00000000-0000-0000-0000-000000000000']), 5);
      expectError(await cli(['retry', '00000000-0000-0000-0000-000000000000']), 'NOT_FOUND', 5);
    });

    it('reports advance when the instance ends right after the write (async continuation)', async () => {
      const edges = join(required(workdir, 'workdir'), 'edges');
      await mkdir(edges);
      await copyFile(FIXTURES.workflowEdges, join(edges, 'edges.bpmn'));
      expectSuccess(await cli(['deploy', edges, '--name', 'edges']));
      for (let run = 0; run < 5; run++) {
        const started = expectSuccess(
          await cli(argv('process-definition start', ['race-end'], {})),
        ).json<{ id: string }>();
        const advanced = expectSuccess(
          await cli(['advance', started.id, '--no-variables']),
        ).json<AdvanceOutput>();
        expect(advanced.advanced).toMatchObject({ activityId: 'review', kind: 'userTask' });
        expect(['ACTIVE', 'COMPLETED', 'ENDED']).toContain(advanced.instance?.state);
      }
    });

    it('treats the job of a suspended job definition as resting, never executes it', async () => {
      expectSuccess(
        await cli(
          argv('job-definition update-suspension-state', [], {
            processDefinitionKey: 'paused',
            suspended: true,
            includeJobs: true,
            yes: true,
          }),
        ),
      );
      const started = expectSuccess(
        await cli(argv('process-definition start', ['paused'], {})),
      ).json<{ id: string }>();
      const view = expectSuccess(await cli(['inspect', started.id])).json<InstanceOutput>();
      expect(view.waitingAt).toEqual([
        expect.objectContaining({ activityId: 'work', kind: 'asyncContinuation', suspended: true }),
      ]);
      expect(view.next ?? []).not.toContain(`operate advance ${started.id}`);
      expectSuccess(await cli(['wait', started.id, '--wait-timeout', '5s']));
      expectError(
        await cli([
          'wait',
          started.id,
          '--execute-jobs',
          '--until',
          'task',
          '--wait-timeout',
          '2s',
        ]),
        'WAIT_TIMEOUT',
        9,
      );
      expectError(await cli(['advance', started.id]), 'USAGE', 2);
      const after = expectSuccess(await cli(['inspect', started.id])).json<InstanceOutput>();
      expect(after.waitingAt[0]).toMatchObject({ activityId: 'work', suspended: true });
      const status = expectSuccess(
        await cli(['status', '--process-definition-key', 'paused', '--stale-after', '1ms']),
      ).json<StatusOutput>();
      expect(status.findings.map((finding) => finding.code)).not.toContain('JOBS_OVERDUE');
    });
  });
}
