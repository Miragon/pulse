import { PatchedCommands, PatchedRuntime } from '../../src/contract/fake/index.js';
import {
  BpmnProcessId,
  BulkOperationId,
  InstanceId,
  PageCursor,
  RuntimeError,
  type BulkOperation,
  type ProcessCommands,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import { describe, expect, test, vi } from 'vitest';
import { BulkRuns } from '../../src/core/panels/bulk-runs.js';
import { DefinitionPanel } from '../../src/core/panels/definition-panel.js';
import type { PanelContext } from '../../src/core/panels/panel-context.js';
import { MessageGuards, type DefinitionView, type PanelState } from '../../src/core/protocol/index.js';
import { panelFixture, type FixtureOptions, type PanelFixture } from './support/panel-fixture.js';
import { WaitGate } from './support/wait-gate.js';

const ORDER = BpmnProcessId('pulse-order');

function readyView(state: PanelState): DefinitionView {
  if (state.status !== 'ready' || state.view.kind !== 'definition') {
    throw new Error(`expected a ready definition view, got ${state.status}`);
  }
  return state.view;
}

interface Opened {
  readonly fixture: PanelFixture;
  readonly panel: DefinitionPanel;
  readonly gate: WaitGate;
  readonly context: PanelContext;
  view(): DefinitionView;
  idOf(businessKey: string): string;
}

async function openOrderV1(
  options: FixtureOptions = { writable: true },
  adapt: (runtime: ProcessRuntime) => ProcessRuntime = (runtime) => runtime,
  shared: Partial<PanelContext> = {},
): Promise<Opened> {
  const fixture = panelFixture(adapt, options);
  const gate = new WaitGate();
  const context: PanelContext = { ...fixture.context, wait: gate.wait, ...shared };
  const panel = new DefinitionPanel(context, {
    bpmnProcessId: ORDER,
    definitionId: fixture.world.definitionIds['order@1'],
    filter: { scope: 'all' },
  });
  await panel.handle({ type: 'ready' });
  const view = () => readyView(fixture.lastState());
  const idOf = (businessKey: string) =>
    view().instances.find((row) => row.businessKey === businessKey)!.id;
  return { fixture, panel, gate, context, view, idOf };
}

async function selectRunning(opened: Opened): Promise<void> {
  await opened.panel.handle({
    type: 'toggleInstances',
    ids: [opened.idOf('ORD-1001'), opened.idOf('ORD-1002')],
    selected: true,
  });
}

async function endBehindThePanel(opened: Opened, ids: readonly InstanceId[]): Promise<void> {
  const operationId = await opened.fixture.context.commands!.cancelInstances(ids);
  await opened.fixture.context.runtime.getBulkOperation(operationId);
}

function withCommands(adapt: (commands: ProcessCommands) => Partial<ProcessCommands>) {
  return {
    writable: true,
    adaptCommands: (commands: ProcessCommands) => new PatchedCommands(commands, adapt(commands)),
  } satisfies FixtureOptions;
}

describe('selecting instances for a bulk operation', () => {
  test('offers no selection on a read-only engine and ignores bulk intents', async () => {
    const opened = await openOrderV1({});
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.view().instances.some((row) => row.selectable === true)).toBe(false);
    expect(opened.view().selection).toBeUndefined();
    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled();
  });

  test('lets only running instances be selected and ignores ids it does not show', async () => {
    const opened = await openOrderV1();

    await opened.panel.handle({
      type: 'toggleInstances',
      ids: [opened.idOf('ORD-1001'), opened.idOf('ORD-1003'), 'smuggled'],
      selected: true,
    });

    const rows = opened.view().instances;
    expect(rows.map((row) => [row.businessKey, row.selectable, row.selected])).toEqual([
      ['ORD-1001', true, true],
      ['ORD-1002', true, undefined],
      ['ORD-1003', undefined, undefined],
    ]);
    expect(opened.view().selection).toMatchObject({
      count: 1,
      allMatching: false,
      matching: 2,
      offers: [{ action: 'cancelInstances', label: 'Cancel instances…' }],
    });
  });

  test('selects every running instance that matches the filter, and clears on a new filter', async () => {
    const opened = await openOrderV1();
    await opened.panel.handle({
      type: 'toggleInstances',
      ids: [opened.idOf('ORD-1001')],
      selected: true,
    });

    await opened.panel.handle({ type: 'selectMatching' });
    expect(opened.view().selection).toMatchObject({ count: 2, allMatching: true });
    expect(opened.view().selection).not.toHaveProperty('matching');

    await opened.panel.handle({ type: 'filterInstances', filter: { scope: 'running' } });
    expect(opened.view().selection).toBeUndefined();
  });

  test('refuses to select more than a thousand instances instead of cutting the list', async () => {
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          countInstances: async (filter) =>
            filter.lifecycle === 'running' ? 1500 : runtime.countInstances(filter),
        }),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'selectMatching' });

    expect(opened.view().selection).toMatchObject({ count: 2, overCap: 1500, cap: 1000 });
    expect(opened.view().selection).not.toHaveProperty('matching');
  });

  test('has no selection under the Ended scope', async () => {
    const opened = await openOrderV1();
    await opened.panel.handle({ type: 'filterInstances', filter: { scope: 'ended' } });

    expect(opened.view().instances.every((row) => row.selectable === undefined)).toBe(true);
  });
});

describe('confirming a bulk cancel', () => {
  test('re-reads the selection and confirms exactly what is still running', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    opened.fixture.calls.length = 0;

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.fixture.calls[0]).toBe('searchInstances');
    expect(opened.fixture.effects.confirmBulk).toHaveBeenCalledWith({
      action: 'cancelInstances',
      title: 'Cancel 2 instances of Order fulfillment v1?',
      facts: [
        'Filter: All',
        expect.stringMatching(/^ORD-100[12], ORD-100[12]$/),
        'Called instances end with them.',
        "Can't be undone; Stop only halts the rest.",
        'Checked just now',
      ],
      confirmLabel: 'Cancel 2 instances',
      selected: 2,
      count: 2,
      countPrompt: 'Type 2 to cancel 2 instances',
      warning: "Cancelling can't be undone.",
      takesReason: true,
      reasonPrompt: 'The engine keeps it with the cancelled instances. Pulse does not log it.',
    });
  });

  test('leaves out an instance that ended after it was selected and says so', async () => {
    let cancelled: readonly string[] = [];
    const opened = await openOrderV1(
      withCommands((commands) => ({
        cancelInstances: (ids, options) => {
          cancelled = ids;
          return commands.cancelInstances(ids, options);
        },
      })),
    );
    await selectRunning(opened);
    const ended = InstanceId(opened.idOf('ORD-1002'));
    await endBehindThePanel(opened, [ended]);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    const request = opened.fixture.effects.confirmBulk.mock.calls[0]![0];
    expect(request.title).toBe('Cancel 1 instance of Order fulfillment v1?');
    expect(request.facts[2]).toBe('1 already ended, left alone');
    expect(cancelled).not.toContain(ended);
    expect(cancelled).toHaveLength(1);
  });

  test('keeps the selection and writes nothing when the dialog is dismissed', async () => {
    const cancelInstances = vi.fn<ProcessCommands['cancelInstances']>();
    const opened = await openOrderV1(withCommands(() => ({ cancelInstances })));
    opened.fixture.effects.confirmBulk.mockResolvedValue(undefined);
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(cancelInstances).not.toHaveBeenCalled();
    expect(opened.view().selection?.count).toBe(2);
    expect(opened.view().bulk).toBeUndefined();
  });

  test('passes the reason the dialog asked for to the engine', async () => {
    const options: unknown[] = [];
    const opened = await openOrderV1(
      withCommands((commands) => ({
        cancelInstances: (ids, given) => {
          options.push(given);
          return commands.cancelInstances(ids, given);
        },
      })),
    );
    opened.fixture.effects.confirmBulk.mockResolvedValue({ reason: 'test data' });
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(options).toEqual([{ reason: 'test data' }]);
  });

  test('tells the user when nothing is left to cancel', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await endBehindThePanel(
      opened,
      ['ORD-1001', 'ORD-1002'].map((key) => InstanceId(opened.idOf(key))),
    );

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled();
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nothing left to cancel.' }),
    );
  });
});

describe('following a bulk cancel', () => {
  test('shows progress, then the result, and reloads the list once at the end', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    expect(opened.view().bulk?.status).toBe('running');
    expect(opened.view().selection).toBeUndefined();
    expect(opened.fixture.effects.reportWritten).toHaveBeenCalledWith(
      'Started to cancel 2 instances on local (localhost).',
    );

    opened.fixture.calls.length = 0;
    await opened.gate.open();

    expect(opened.gate.delays[0]).toBe(2000);
    expect(opened.fixture.calls.slice(0, 2)).toEqual(['getBulkOperation', 'countInstances']);
    expect(opened.view().bulk).toMatchObject({
      status: 'finished',
      progress: { total: 2, done: 2, failed: 0 },
      notice: { tone: 'info', title: 'Cancelled 2 instances.' },
    });
    expect(opened.view().instances.map((row) => row.state)).toEqual([
      'Terminated',
      'Terminated',
      'Completed',
    ]);
    expect(opened.gate.pending).toBe(0);

    await opened.panel.handle({ type: 'dismissBulk' });
    expect(opened.view().bulk).toBeUndefined();
  });

  test('stops a running operation and offers the instances it did not reach', async () => {
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: async (id) => {
            const operation = await runtime.getBulkOperation(id);
            return operation?.state === 'running' ? { ...operation, completed: 0 } : operation;
          },
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    expect(opened.view().bulk?.notice.actions).toEqual([{ kind: 'stopBulk', label: 'Stop' }]);

    await opened.panel.handle({ type: 'stopBulk' });
    expect(opened.view().bulk?.status).toBe('stopping');
    await opened.gate.open();
    await opened.gate.open();

    expect(opened.view().bulk).toMatchObject({
      status: 'stopped',
      notice: {
        title: 'Stopped. 0 of 2 cancelled, 2 still running.',
        actions: [
          { kind: 'selectRemaining', label: 'Select the 2 still running' },
          { kind: 'dismissBulk', label: 'Dismiss' },
        ],
      },
    });

    await opened.panel.handle({ type: 'selectRemaining' });
    expect(opened.view().bulk).toBeUndefined();
    expect(opened.view().selection?.count).toBe(2);
  });

  test('says the outcome is unknown when the engine did not answer the submit', async () => {
    const opened = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () =>
          Promise.reject(new RuntimeError('unreachable', 'Cannot reach the engine')),
      })),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.view().bulk).toMatchObject({
      status: 'unknown',
      notice: {
        actions: [
          { kind: 'checkBulk', label: 'Check instances' },
          { kind: 'dismissBulk', label: 'Dismiss' },
        ],
      },
    });
    expect(opened.gate.pending).toBe(0);

    await opened.panel.handle({ type: 'checkBulk' });
    expect(opened.view().bulk?.notice.detail).toBe('2 of 2 still running.');
  });

  test('reports a refused submit as failed', async () => {
    const opened = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () => Promise.reject(new RuntimeError('rejected', 'not allowed')),
      })),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.view().bulk).toMatchObject({ status: 'failed', notice: { tone: 'danger' } });
  });

  test('warns when nothing moved for two minutes on a local engine', async () => {
    let now = new Date('2026-10-21T09:00:00Z');
    const stuck: Partial<ProcessRuntime> = {
      getBulkOperation: (id) =>
        Promise.resolve({
          id,
          kind: 'cancelInstances',
          state: 'running',
          total: 2,
          completed: 0,
          failed: 0,
          startedAt: '2026-10-21T09:00:00.000Z',
        } as BulkOperation),
    };
    const opened = await openOrderV1(
      { writable: true, now: () => now },
      (runtime) => new PatchedRuntime(runtime, stuck),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    now = new Date('2026-10-21T09:02:30Z');
    await opened.gate.open();

    expect(opened.view().bulk).toMatchObject({
      status: 'stalled',
      notice: { tone: 'warning', title: 'No progress for 2 min 30 s: 0 of 2 done' },
    });
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('does not read the operation while the engine lane is blocked', async () => {
    const opened = await openOrderV1({ writable: true, live: 'on' });
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    opened.context.live!.lane.block();
    opened.fixture.calls.length = 0;

    await opened.gate.open();

    expect(opened.fixture.calls).toEqual([]);
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('blocks the lane when reading the operation is refused for the login', async () => {
    const opened = await openOrderV1(
      { writable: true, live: 'on' },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: () => Promise.reject(new RuntimeError('unauthorized', 'locked')),
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.gate.open();

    expect(opened.context.live!.lane.isBlocked).toBe(true);
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('waits while the panel is hidden and reads again once it is shown', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    opened.panel.attend('hidden');
    opened.fixture.calls.length = 0;

    await opened.gate.open();
    expect(opened.fixture.calls).toEqual([]);

    opened.panel.attend('watched');
    await opened.gate.open();
    expect(opened.fixture.calls[0]).toBe('getBulkOperation');
  });

  test('picks a running operation up again in a new panel of the same process', async () => {
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1({ writable: true }, (runtime) => runtime, { bulkRuns });
    await selectRunning(first);
    await first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    first.panel.dispose();
    await first.gate.open();

    const second = new DefinitionPanel(
      { ...first.context, wait: first.gate.wait },
      { bpmnProcessId: ORDER, definitionId: first.fixture.world.definitionIds['order@1'] },
    );
    await second.handle({ type: 'ready' });
    expect(readyView(first.fixture.lastState()).bulk?.status).toBe('running');

    await second.handle({ type: 'selectMatching' });
    await second.handle({ type: 'startBulk', action: 'cancelInstances' });
    expect(first.fixture.effects.confirmBulk).toHaveBeenCalledTimes(1);

    await first.gate.open();
    expect(readyView(first.fixture.lastState()).bulk?.status).toBe('finished');
  });

  test('names the version of an operation that runs on another version than shown', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.panel.handle({
      type: 'selectVersion',
      definitionId: opened.fixture.world.definitionIds['order@2'],
    });

    expect(opened.view().bulk?.notice.title).toBe('Cancelling instances of v1: 0 of 2 done');
  });
});

describe('edges of a bulk cancel', () => {
  test('clears the selection on request and says when another operation runs', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await opened.panel.handle({ type: 'clearSelection' });
    expect(opened.view().selection).toBeUndefined();

    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await opened.panel.handle({
      type: 'toggleInstances',
      ids: [opened.idOf('ORD-1001')],
      selected: true,
    });
    await opened.panel.handle({ type: 'dismissBulk' });

    expect(opened.view().selection?.blockedBy).toBe('Wait until cancelling 2 instances ends');
    expect(opened.view().bulk?.status).toBe('running');
  });

  test('refuses all matching when there turn out to be more than a thousand', async () => {
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          searchInstances: async (filter, page) => {
            if (filter.instanceIds !== undefined || page.limit !== 250) {
              return runtime.searchInstances(filter, page);
            }
            const [template] = (await runtime.searchInstances(filter, { limit: 1 })).items;
            const offset = Number(page.after ?? 0);
            return {
              items: Array.from({ length: 250 }, (_, index) => ({
                ...template!,
                id: InstanceId(`many-${offset + index}`),
              })),
              next: PageCursor(String(offset + 250)),
            };
          },
        }),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'selectMatching' });

    expect(opened.view().selection).toMatchObject({ count: 2, overCap: 1250 });
  });

  test('reports a failed read instead of selecting', async () => {
    let failing = false;
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          searchInstances: (filter, page) =>
            failing
              ? Promise.reject(new RuntimeError('unreachable', 'down'))
              : runtime.searchInstances(filter, page),
        }),
    );
    await selectRunning(opened);
    failing = true;

    await opened.panel.handle({ type: 'selectMatching' });
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledTimes(2);
    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled();
    expect(opened.view().selection?.count).toBe(2);
  });

  test('says nothing is left when the one selected instance ended', async () => {
    const opened = await openOrderV1();
    const id = InstanceId(opened.idOf('ORD-1001'));
    await opened.panel.handle({ type: 'toggleInstances', ids: [id], selected: true });
    await endBehindThePanel(opened, [id]);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ detail: '1 selected instance has already ended.' }),
    );
  });

  test('keeps running and shows why when Stop is refused', async () => {
    const opened = await openOrderV1(
      withCommands(() => ({
        stopBulkOperation: () => Promise.reject(new RuntimeError('rejected', 'not yours')),
      })),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.panel.handle({ type: 'stopBulk' });

    expect(opened.view().bulk).toMatchObject({
      status: 'running',
      notice: { actions: [{ kind: 'stopBulk', label: 'Stop' }] },
    });
    expect(opened.view().bulk?.notice.detail).toContain('not yours');
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledTimes(1);
  });

  test('checks the instances itself when the engine forgot the operation', async () => {
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, { getBulkOperation: () => Promise.resolve(undefined) }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.gate.open();

    expect(opened.view().bulk).toMatchObject({
      status: 'finished',
      notice: { title: 'Cancelled 0 of 2. 2 still running.' },
    });
  });

  test('ignores intents that do not fit the state of the run', async () => {
    const opened = await openOrderV1();
    await opened.panel.handle({ type: 'stopBulk' });
    await opened.panel.handle({ type: 'checkBulk' });
    await opened.panel.handle({ type: 'selectRemaining' });
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    opened.fixture.calls.length = 0;

    await opened.panel.handle({ type: 'checkBulk' });
    await opened.panel.handle({ type: 'selectRemaining' });

    expect(opened.fixture.calls).toEqual([]);
    expect(opened.view().bulk?.status).toBe('running');
  });

  test('reports a failed read when it selects the instances still running', async () => {
    let failing = false;
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: () => Promise.resolve(undefined),
          searchInstances: (filter, page) =>
            failing
              ? Promise.reject(new RuntimeError('unreachable', 'down'))
              : runtime.searchInstances(filter, page),
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await opened.gate.open();
    failing = true;

    await opened.panel.handle({ type: 'selectRemaining' });

    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledTimes(1);
    expect(opened.view().bulk?.status).toBe('finished');
  });

  test('lets only one of two open panels read the operation', async () => {
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1({ writable: true }, (runtime) => runtime, { bulkRuns });
    await selectRunning(first);
    await first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
    });

    await second.handle({ type: 'ready' });

    expect(first.gate.pending).toBe(1);
  });
});

describe('findings of the review', () => {
  test('follows the run again in the panel that replaces a rebound one', async () => {
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1({ writable: true }, (runtime) => runtime, { bulkRuns });
    await selectRunning(first);
    await first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    first.panel.dispose();

    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
    });
    await second.handle({ type: 'ready' });
    await first.gate.open();
    await first.gate.open();

    expect(readyView(first.fixture.lastState()).bulk?.status).toBe('finished');
  });

  test('lets a watched panel take over from one that was hidden', async () => {
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1({ writable: true }, (runtime) => runtime, { bulkRuns });
    await selectRunning(first);
    await first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    first.panel.attend('hidden');
    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
    });

    await second.handle({ type: 'ready' });
    await first.gate.open();
    await first.gate.open();

    expect(readyView(first.fixture.lastState()).bulk?.status).toBe('finished');
  });

  test('refuses a second run that two panels confirmed at the same time', async () => {
    const cancelled: unknown[] = [];
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1(
      withCommands((commands) => ({
        cancelInstances: (ids, options) => {
          cancelled.push(ids);
          return commands.cancelInstances(ids, options);
        },
      })),
      (runtime) => runtime,
      { bulkRuns },
    );
    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
      filter: { scope: 'all' },
    });
    await second.handle({ type: 'ready' });
    await selectRunning(first);
    await second.handle({ type: 'selectMatching' });

    await Promise.all([
      first.panel.handle({ type: 'startBulk', action: 'cancelInstances' }),
      second.handle({ type: 'startBulk', action: 'cancelInstances' }),
    ]);

    expect(cancelled).toHaveLength(1);
    expect(first.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Another bulk write runs on this process.' }),
    );
  });

  test('writes nothing when the panel closed while its dialog was open', async () => {
    const opened = await openOrderV1();
    let answer: (value: object) => void = () => undefined;
    opened.fixture.effects.confirmBulk.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await selectRunning(opened);
    const started = opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await WaitGate.settle();

    opened.panel.dispose();
    answer({});
    await started;

    expect(opened.context.bulkRuns.of(ORDER)).toBeUndefined();
  });

  test('says it cannot read the progress instead of blaming the engine', async () => {
    let now = new Date('2026-10-21T09:00:00Z');
    const opened = await openOrderV1(
      { writable: true, now: () => now },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: () => Promise.reject(new RuntimeError('unreachable', 'down')),
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    now = new Date('2026-10-21T09:10:00Z');

    await opened.gate.open();

    expect(opened.view().bulk).toMatchObject({
      status: 'running',
      notice: {
        tone: 'warning',
        detail: expect.stringMatching(/^Pulse can't read its progress: /) as string,
      },
    });
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('says the reads wait for the login while the lane is blocked', async () => {
    const opened = await openOrderV1({ writable: true, live: 'on' });
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    opened.context.live!.lane.block();

    await opened.gate.open();

    expect(opened.view().bulk?.notice.detail).toBe(
      "Pulse can't read its progress: Paused until the engine accepts the login again.",
    );
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('ignores selection and start under the Ended scope', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await opened.panel.handle({ type: 'filterInstances', filter: { scope: 'ended' } });

    await opened.panel.handle({ type: 'selectMatching' });
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled();
  });

  test('treats an engine failure on submit as an open outcome', async () => {
    const opened = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () => Promise.reject(new RuntimeError('engineFailure', 'gateway')),
      })),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.view().bulk?.status).toBe('unknown');
  });

  test('keeps the selection when the engine refused to start', async () => {
    const opened = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () => Promise.reject(new RuntimeError('rejected', 'no')),
      })),
    );
    await selectRunning(opened);

    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    expect(opened.view().selection?.count).toBe(2);
  });

  test('offers Stop again while the engine keeps a halted operation', async () => {
    const stops: unknown[] = [];
    let halted = true;
    const opened = await openOrderV1(
      {
        writable: true,
        adaptCommands: (commands) =>
          new PatchedCommands(commands, {
            stopBulkOperation: (id) => {
              stops.push(id);
              return Promise.resolve();
            },
          }),
      },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: async (id) => {
            const operation = await runtime.getBulkOperation(id);
            return halted && operation !== undefined
              ? { ...operation, state: 'suspended', completed: 0 }
              : operation;
          },
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await opened.panel.handle({ type: 'stopBulk' });
    await opened.gate.open();
    await opened.gate.open();

    expect(opened.view().bulk).toMatchObject({
      status: 'stopped',
      notice: {
        detail: 'The engine keeps the halted operation. Stop again to remove it.',
        actions: [
          { kind: 'stopBulk', label: 'Stop' },
          { kind: 'dismissBulk', label: 'Dismiss' },
        ],
      },
    });

    halted = false;
    await opened.panel.handle({ type: 'stopBulk' });
    expect(stops).toHaveLength(2);
  });

  test('reports the outcome of a finished run for the audit', async () => {
    const opened = await openOrderV1();
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.gate.open();

    expect(opened.fixture.effects.reportBulkOutcome).toHaveBeenCalledWith({
      action: 'cancelInstances',
      operationId: 'fake-bulk-1',
      phase: 'finished',
      total: 2,
      remaining: 0,
      failed: 0,
    });
  });

  test('blocks the lane when Stop is refused for the login', async () => {
    const opened = await openOrderV1({
      writable: true,
      live: 'on',
      adaptCommands: (commands) =>
        new PatchedCommands(commands, {
          stopBulkOperation: () => Promise.reject(new RuntimeError('unauthorized', 'locked')),
        }),
    });
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    await opened.panel.handle({ type: 'stopBulk' });

    expect(opened.context.live!.lane.isBlocked).toBe(true);
    opened.panel.dispose();
    await opened.gate.open();
  });

  test('reports a failed check of an open outcome', async () => {
    let failing = false;
    const opened = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () => Promise.reject(new RuntimeError('unreachable', 'down')),
      })),
      (runtime) =>
        new PatchedRuntime(runtime, {
          countInstances: (filter) =>
            failing
              ? Promise.reject(new RuntimeError('unreachable', 'down'))
              : runtime.countInstances(filter),
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    failing = true;

    await opened.panel.handle({ type: 'checkBulk' });

    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledTimes(1);
  });
});

describe('findings of the second review', () => {
  async function twoPanels() {
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1({ writable: true }, (runtime) => runtime, { bulkRuns });
    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
    });
    await second.handle({ type: 'ready' });
    return { first, second };
  }

  test('keeps following when the panel was hidden and shown during a read', async () => {
    let answer: () => void = () => undefined;
    const opened = await openOrderV1(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkOperation: async (id) => {
            await new Promise<void>((resolve) => {
              answer = resolve;
            });
            return runtime.getBulkOperation(id);
          },
        }),
    );
    await selectRunning(opened);
    await opened.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await opened.gate.open();

    opened.panel.attend('hidden');
    opened.panel.attend('watched');
    answer();
    await WaitGate.settle();

    expect(opened.gate.pending).toBe(1);
  });

  test('hands the run to another watched panel when the following one is hidden', async () => {
    const { first, second } = await twoPanels();
    await selectRunning(first);
    await first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });

    first.panel.attend('hidden');
    await first.gate.open();
    await first.gate.open();

    expect(readyView(first.fixture.lastState()).bulk?.status).toBe('finished');
    second.dispose();
  });

  test('does not let a panel read a run whose start is still under way', async () => {
    let started: (id: BulkOperationId) => void = () => undefined;
    const bulkRuns = new BulkRuns();
    const first = await openOrderV1(
      withCommands(() => ({
        cancelInstances: () =>
          new Promise<BulkOperationId>((resolve) => {
            started = resolve;
          }),
      })),
      (runtime) => runtime,
      { bulkRuns },
    );
    await selectRunning(first);
    const starting = first.panel.handle({ type: 'startBulk', action: 'cancelInstances' });
    await WaitGate.settle();
    const second = new DefinitionPanel(first.context, {
      bpmnProcessId: ORDER,
      definitionId: first.fixture.world.definitionIds['order@1'],
    });

    await second.handle({ type: 'ready' });
    expect(first.gate.pending).toBe(0);
    expect(bulkRuns.of(ORDER)?.phase).toBe('submitting');

    first.panel.dispose();
    started(BulkOperationId('fake-bulk-1'));
    await starting;
    expect(first.gate.pending).toBe(1);
  });
});

describe('bulk intents from the webview', () => {
  test('accept at most a thousand ids and only known actions', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `id-${index}`);

    expect(
      MessageGuards.isWebviewIntent({ type: 'toggleInstances', ids: ids(1000), selected: true }),
    ).toBe(true);
    expect(
      MessageGuards.isWebviewIntent({ type: 'toggleInstances', ids: ids(1001), selected: true }),
    ).toBe(false);
    expect(
      MessageGuards.isWebviewIntent({ type: 'toggleInstances', ids: [1], selected: true }),
    ).toBe(false);
    expect(MessageGuards.isWebviewIntent({ type: 'startBulk', action: 'cancelInstances' })).toBe(
      true,
    );
    expect(MessageGuards.isWebviewIntent({ type: 'startBulk', action: 'deleteEverything' })).toBe(
      false,
    );
  });
});
