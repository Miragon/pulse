import {
  BpmnProcessId,
  DefinitionId,
  RuntimeError,
  type DefinitionSummary,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import { PatchedRuntime } from '../../src/contract/fake/index.js';
import { describe, expect, test } from 'vitest';
import { EnginePanel } from '../../src/core/panels/engine-panel.js';
import type { EngineView, PanelState } from '../../src/core/protocol/index.js';
import { panelFixture } from './support/panel-fixture.js';

function readyView(state: PanelState): EngineView {
  if (state.status !== 'ready' || state.view.kind !== 'engine') {
    throw new Error(`expected a ready engine view, got ${state.status}`);
  }
  return state.view;
}

function summary(
  bpmnProcessId: string,
  counts: { readonly running: number; readonly withIncident: number },
  name?: string,
): DefinitionSummary {
  return {
    latest: {
      id: DefinitionId(`${bpmnProcessId}:4`),
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      version: 4,
      ...(name === undefined ? {} : { name }),
    },
    ...counts,
  };
}

function listing(definitions: readonly DefinitionSummary[]) {
  return (runtime: ProcessRuntime) =>
    new PatchedRuntime(runtime, { listDefinitions: () => Promise.resolve(definitions) });
}

const MIXED = [
  summary('zeta', { running: 5, withIncident: 0 }, 'Zeta'),
  summary('alpha', { running: 1, withIncident: 0 }, 'Alpha'),
  summary('beta', { running: 0, withIncident: 2 }, 'Beta'),
  summary('audit', { running: 1, withIncident: 0 }),
  summary('gamma', { running: 9, withIncident: 2 }, 'Gamma'),
];

describe('the engine panel', () => {
  test('lists every process with its latest version and counts, and sums them up', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'ready' });

    const view = readyView(fixture.lastState());
    expect(fixture.states[0]).toEqual({
      status: 'loading',
      title: 'local',
      engine: fixture.context.engine,
    });
    expect(view.processes).toEqual([
      {
        bpmnProcessId: 'pulse-order',
        name: 'Order fulfillment',
        latestVersion: 2,
        running: 3,
        withIncident: 1,
      },
      {
        bpmnProcessId: 'pulse-dispatch',
        name: 'Dispatch order',
        latestVersion: 1,
        running: 1,
        withIncident: 1,
      },
      {
        bpmnProcessId: 'pulse-label',
        name: 'Print label',
        latestVersion: 1,
        running: 1,
        withIncident: 1,
      },
    ]);
    expect(view.summary).toBe('3 processes · 5 running · 3 with incident');
    expect(view.scopeCounts).toEqual({ all: 3, withIncident: 3 });
    expect(view.filter).toEqual({ scope: 'all' });
    expect(view.engine).toEqual({ ...fixture.context.engine, product: 'Fake engine 1.0.0' });
    expect(view.asOf).toBe('2026-10-21T09:00:00.000Z');
  });

  test('reads the engine with one list and one description, never per process', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'ready' });
    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all', search: 'order' } });

    expect([...fixture.calls].sort()).toEqual(['describeEngine', 'listDefinitions']);
  });

  test('shows a webview that comes back the loaded list without reading the engine again', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'ready' });

    expect(fixture.calls).toHaveLength(2);
    expect(fixture.states.map((state) => state.status)).toEqual(['loading', 'ready', 'ready']);
  });

  test('puts processes with incidents first, then the busiest, then by name', async () => {
    const fixture = panelFixture(listing(MIXED));
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'ready' });

    const rows = readyView(fixture.lastState()).processes;
    expect(rows.map((row) => row.bpmnProcessId)).toEqual([
      'gamma',
      'beta',
      'zeta',
      'alpha',
      'audit',
    ]);
    expect(rows[4]).not.toHaveProperty('name');
  });

  test('searches name and BPMN process id, and counts what the search leaves', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all', search: 'PRINT' } });
    const byName = readyView(fixture.lastState());
    await panel.handle({
      type: 'filterProcesses',
      filter: { scope: 'withIncident', search: 'pulse-disp' },
    });
    const byId = readyView(fixture.lastState());

    expect(byName.processes.map((row) => row.bpmnProcessId)).toEqual(['pulse-label']);
    expect(byName.scopeCounts).toEqual({ all: 1, withIncident: 1 });
    expect(byName.summary).toBe('3 processes · 5 running · 3 with incident');
    expect(byId.processes.map((row) => row.bpmnProcessId)).toEqual(['pulse-dispatch']);
    expect(byId.filter).toEqual({ scope: 'withIncident', search: 'pulse-disp' });
    expect(byId.asOf).toBe(byName.asOf);
  });

  test('shows only the processes with an incident in that scope', async () => {
    const fixture = panelFixture(listing(MIXED));
    const panel = new EnginePanel(fixture.context);
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'filterProcesses', filter: { scope: 'withIncident' } });

    const view = readyView(fixture.lastState());
    expect(view.processes.map((row) => row.bpmnProcessId)).toEqual(['gamma', 'beta']);
    expect(view.scopeCounts).toEqual({ all: 5, withIncident: 2 });
    expect(view.summary).toBe('5 processes · 16 running · 4 with incident');
  });

  test('applies a filter that arrives before the engine has answered', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all', search: 'order' } });
    await panel.handle({ type: 'ready' });

    const view = readyView(fixture.lastState());
    expect(view.filter).toEqual({ scope: 'all', search: 'order' });
    expect(view.processes.map((row) => row.bpmnProcessId)).toEqual([
      'pulse-order',
      'pulse-dispatch',
    ]);
  });

  test('says when nothing is deployed and when nothing matches', async () => {
    const empty = panelFixture(listing([]));
    await new EnginePanel(empty.context).handle({ type: 'ready' });
    const single = panelFixture(listing([summary('alpha', { running: 1, withIncident: 0 })]));
    const panel = new EnginePanel(single.context);
    await panel.handle({ type: 'ready' });
    const one = readyView(single.lastState());

    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all', search: 'nothing' } });

    expect(readyView(empty.lastState())).toMatchObject({
      processes: [],
      summary: '0 processes · 0 running · 0 with incident',
      emptyText: 'No processes deployed on local.',
    });
    expect(one.summary).toBe('1 process · 1 running · 0 with incident');
    expect(readyView(single.lastState())).toMatchObject({
      processes: [],
      scopeCounts: { all: 0, withIncident: 0 },
      emptyText: 'No processes match this filter.',
    });
  });

  test('opens the latest version of a listed process, to the side on request', async () => {
    const fixture = panelFixture();
    const panel = new EnginePanel(fixture.context);
    await panel.handle({ type: 'openProcess', bpmnProcessId: 'pulse-order', toSide: false });
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'openProcess', bpmnProcessId: 'pulse-order', toSide: true });
    await panel.handle({ type: 'openProcess', bpmnProcessId: 'unknown', toSide: false });

    expect(fixture.effects.openLatestDefinition.mock.calls).toEqual([
      ['pulse-order', { toSide: true }],
    ]);
  });

  test('shows the processes without a product when the engine does not describe itself', async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          describeEngine: () => Promise.reject(new RuntimeError('forbidden', 'HTTP 403.')),
        }),
    );
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'ready' });

    const view = readyView(fixture.lastState());
    expect(view.engine).toEqual(fixture.context.engine);
    expect(view.processes).toHaveLength(3);
  });

  test('fails with the problem, and asks for credentials when they were rejected', async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          listDefinitions: () => Promise.reject(new RuntimeError('unauthorized', 'HTTP 401.')),
        }),
    );
    const panel = new EnginePanel(fixture.context);

    await panel.handle({ type: 'ready' });
    await panel.handle({ type: 'setCredentials' });

    expect(fixture.lastState()).toEqual({
      status: 'failed',
      engine: fixture.context.engine,
      problem: {
        title: 'local rejected the credentials.',
        detail: 'HTTP 401.',
        canEditConnection: true,
        needsCredentials: true,
      },
    });
    expect(fixture.effects.setCredentials).toHaveBeenCalledOnce();
  });

  test('keeps a failed refresh failed while the list is filtered, until a refresh works', async () => {
    let reachable = true;
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          listDefinitions: () =>
            reachable
              ? runtime.listDefinitions()
              : Promise.reject(new RuntimeError('unreachable', 'ECONNREFUSED')),
        }),
    );
    const panel = new EnginePanel(fixture.context);
    await panel.handle({ type: 'ready' });
    reachable = false;
    await panel.handle({ type: 'refresh' });

    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all', search: 'label' } });

    const failed = fixture.lastState();
    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' && failed.staleView).toMatchObject({
      processes: [expect.objectContaining({ bpmnProcessId: 'pulse-label' })],
    });

    reachable = true;
    await panel.handle({ type: 'refresh' });
    await panel.handle({ type: 'filterProcesses', filter: { scope: 'all' } });

    expect(readyView(fixture.lastState()).processes).toHaveLength(3);
    expect(fixture.calls.filter((call) => call === 'listDefinitions')).toHaveLength(3);
  });

  test('links the start page of the engine web UI, when the engine has one', async () => {
    const engine = { name: 'shop-dev', environment: 'local', host: 'h', webUi: 'Cockpit' } as const;
    const withWebUi = panelFixture(undefined, { engine });
    const withWebUiPanel = new EnginePanel(withWebUi.context);
    const without = panelFixture();
    const withoutPanel = new EnginePanel(without.context);
    await withWebUiPanel.handle({ type: 'ready' });
    await withoutPanel.handle({ type: 'ready' });

    await withWebUiPanel.handle({ type: 'openWebUi' });
    await withoutPanel.handle({ type: 'openWebUi' });

    expect(readyView(withWebUi.lastState()).webUi).toEqual({
      label: 'Open in Cockpit',
      title: 'Open Cockpit on shop-dev',
    });
    expect(withWebUi.effects.openWebUi).toHaveBeenCalledWith({ kind: 'engine' });
    expect(readyView(without.lastState())).not.toHaveProperty('webUi');
    expect(without.effects.openWebUi).not.toHaveBeenCalled();
  });
});
